/*
 * Copyright (c) 2011 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Florian Müllner <fmuellner@redhat.com>
 *
 */

const Lang = imports.lang;
const Signals = imports.signals;

const GdPrivate = imports.gi.GdPrivate;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const Goa = imports.gi.Goa;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Tracker = imports.gi.Tracker;

const Application = imports.application;
const Format = imports.format;
const Path = imports.path;
const Query = imports.query;
const Search = imports.search;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;

let collectionManager = null;
let offsetController = null;
let queryBuilder = null;
let searchCategoryManager = null;
let searchMatchManager = null;
let searchTypeManager = null;
let searchController = null;
let sourceManager = null;

const SEARCH_PROVIDER_IFACE = 'org.gnome.Shell.SearchProvider2';
const SEARCH_PROVIDER_NAME  = 'org.gnome.Documents.SearchProvider';
const SEARCH_PROVIDER_PATH  = '/org/gnome/Documents/SearchProvider';

const _SHELL_SEARCH_ICON_SIZE = 128;

const SearchProviderIface = <interface name={SEARCH_PROVIDER_IFACE}>
<method name="GetInitialResultSet">
  <arg type="as" direction="in" />
  <arg type="as" direction="out" />
</method>
<method name = "GetSubsearchResultSet">
  <arg type="as" direction="in" />
  <arg type="as" direction="in" />
  <arg type="as" direction="out" />
</method>
<method name = "GetResultMetas">
  <arg type="as" direction="in" />
  <arg type="aa{sv}" direction="out" />
</method>
<method name = "ActivateResult">
  <arg type="s" direction="in" />
  <arg type="as" direction="in" />
  <arg type="u" direction="in" />
</method>
<method name = "LaunchSearch">
  <arg type="as" direction="in" />
  <arg type="u" direction="in" />
</method>
</interface>;

function _createThumbnailIcon(uri) {
    let file = Gio.file_new_for_uri(uri);

    try {
        let info = file.query_info(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
                                   0, null);
        let path = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (path)
            return new Gio.FileIcon({ file: Gio.file_new_for_path(path) });
    } catch(e) {
        log(e);
    }
    return null;
}

function _createGIcon(cursor) {
    let gicon = null;

    let ident = cursor.get_string(Query.QueryColumns.IDENTIFIER)[0];
    let isRemote = ident && (ident.indexOf('https://docs.google.com') != -1);

    if (!isRemote) {
        let uri = cursor.get_string(Query.QueryColumns.URI)[0];
        if (uri)
            gicon = _createThumbnailIcon(uri);
    }

    if (gicon)
        return gicon;

    let mimetype = cursor.get_string(Query.QueryColumns.MIMETYPE)[0];
    if (mimetype)
        gicon = Gio.content_type_get_icon(mimetype);

    if (gicon)
        return gicon;

    let rdftype = cursor.get_string(Query.QueryColumns.RDFTYPE)[0];
    if (rdftype)
        gicon = Utils.iconFromRdfType(rdftype);

    if (!gicon)
        gicon = new Gio.ThemedIcon({ name: 'text-x-generic' });

    return gicon;
}

const CreateCollectionIconJob = new Lang.Class({
    Name: 'CreateCollectionIconJob',

    _init: function(id) {
        this._id = id;
        this._itemIcons = [];
        this._itemIds = [];
        this._itemJobs = 0;
    },

    run: function(callback) {
        this._callback = callback;

        let query = queryBuilder.buildCollectionIconQuery(this._id);
        Application.connectionQueue.add(query.sparql, null, Lang.bind(this,
            function(object, res) {
                let cursor = null;

                try {
                    cursor = object.query_finish(res);
                    cursor.next_async(null, Lang.bind(this, this._onCursorNext));
                } catch (e) {
                    log('Error querying tracker: ' + e);
                    this._hasItemIds();
                }
            }));
    },

    _createItemIcon: function(cursor) {
        let pixbuf = null;
        let icon = _createGIcon(cursor);

        if (icon instanceof Gio.ThemedIcon) {
            let theme = Gtk.IconTheme.get_default();
            let flags =
                Gtk.IconLookupFlags.FORCE_SIZE |
                Gtk.IconLookupFlags.GENERIC_FALLBACK;
            let info =
                theme.lookup_by_gicon(icon, _SHELL_SEARCH_ICON_SIZE,
                                      flags);

            try {
                pixbuf = info.load_icon();
            } catch(e) {
                log("Unable to load pixbuf: " + e);
            }
        } else if (icon instanceof Gio.FileIcon) {
            try {
                let stream = icon.load(_SHELL_SEARCH_ICON_SIZE, null)[0];
                pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream,
                                                          null);
            } catch(e) {
                log("Unable to load pixbuf: " + e);
            }
        }

        return pixbuf;
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            cursor.close();
            log('Error querying tracker: ' + e);

            this._hasItemIds();
        }

        if (valid) {
            this._itemIds.push(cursor.get_string(0)[0]);
            cursor.next_async(null, Lang.bind(this, this._onCursorNext));
        } else {
            cursor.close();
            this._hasItemIds();
        }
    },

    _hasItemIds: function() {
        if (this._itemIds.length == 0) {
            this._returnPixbuf();
            return;
        }

        this._itemIds.forEach(Lang.bind(this,
            function(itemId) {
                let job = new TrackerUtils.SingleItemJob(itemId, queryBuilder);
                this._itemJobs++;
                job.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                    function(cursor) {
                        let icon = this._createItemIcon(cursor);
                        if (icon)
                            this._itemIcons.push(icon);
                        this._itemJobCollector();
                    }));
            }));
    },

    _itemJobCollector: function() {
        this._itemJobs--;

        if (this._itemJobs == 0)
            this._returnPixbuf();
    },

    _returnPixbuf: function() {
        this._callback(GdPrivate.create_collection_icon(_SHELL_SEARCH_ICON_SIZE, this._itemIcons));
    }
});

const FetchMetasJob = new Lang.Class({
    Name: 'FetchMetasJob',

    _init: function(ids) {
        this._ids = ids;
        this._metas = [];
    },

    _jobCollector: function() {
        this._activeJobs--;

        if (this._activeJobs == 0)
            this._callback(this._metas);
    },

    _createCollectionPixbuf: function(meta) {
        let job = new CreateCollectionIconJob(meta.id);
        job.run(Lang.bind(this,
            function(icon) {
                if (icon)
                    meta.pixbuf = icon;

                this._metas.push(meta);
                this._jobCollector();
            }));
    },

    run: function(callback) {
        this._callback = callback;
        this._activeJobs = this._ids.length;

        this._ids.forEach(Lang.bind(this,
            function(id) {
                let single = new TrackerUtils.SingleItemJob(id, queryBuilder);
                single.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                    function(cursor) {
                        let title =    cursor.get_string(Query.QueryColumns.TITLE)[0];
                        let filename = cursor.get_string(Query.QueryColumns.FILENAME)[0];
                        let rdftype =  cursor.get_string(Query.QueryColumns.RDFTYPE)[0];

                        let gicon = null;
                        let pixbuf = null;

                        // Collection
                        let isCollection = (rdftype.indexOf('nfo#DataContainer') != -1);

                        if (!isCollection)
                            gicon = _createGIcon(cursor);

                        if (!title || title == '')
                            title = GdPrivate.filename_strip_extension(filename);

                        if (!title || title == '')
                            title = _("Untitled Document");

                        let meta = { id: id, title: title, icon: gicon };

                        if (isCollection) {
                            this._createCollectionPixbuf(meta);
                        } else {
                            this._metas.push(meta);
                            this._jobCollector();
                        }
                    }));
            }));
    }
});

const FetchIdsJob = new Lang.Class({
    Name: 'FetchIdsJob',

    _init: function(terms) {
        this._terms = terms;
        this._ids = [];
    },

    run: function(callback, cancellable) {
        this._callback = callback;
        this._cancellable = cancellable;
        searchController.setString(this._terms.join(' ').toLowerCase());

        let query = queryBuilder.buildGlobalQuery();
        Application.connectionQueue.add(query.sparql, this._cancellable, Lang.bind(this,
            function(object, res) {
                let cursor = null;

                try {
                    cursor = object.query_finish(res);
                    cursor.next_async(this._cancellable, Lang.bind(this, this._onCursorNext));
                } catch (e) {
                    log('Error querying tracker: ' + e);
                    callback(this._ids);
                }
            }));
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            cursor.close();
            log('Error querying tracker: ' + e);

            this._callback(this._ids);
        }

        if (valid) {
            this._ids.push(cursor.get_string(Query.QueryColumns.URN)[0]);
            cursor.next_async(this._cancellable, Lang.bind(this, this._onCursorNext));
        } else {
            cursor.close();
            this._callback(this._ids);
        }
    }
});

const ShellSearchProvider = new Lang.Class({
    Name: 'ShellSearchProvider',

    _init: function() {
        Application.application.hold();
        Gio.DBus.own_name(Gio.BusType.SESSION,
                          SEARCH_PROVIDER_NAME,
                          Gio.BusNameOwnerFlags.NONE,
                          Lang.bind(this, this._onBusAcquired),
                          null, null);

        this._cache = {};
        this._cancellable = new Gio.Cancellable();

        Search.initSearch(imports.shellSearchProvider);
    },

    _onBusAcquired: function() {
        let dbusImpl = Gio.DBusExportedObject.wrapJSObject(SearchProviderIface, this);
        dbusImpl.export(Gio.DBus.session, SEARCH_PROVIDER_PATH);
        Application.application.release();
    },

    _returnMetasFromCache: function(ids, invocation) {
        let metas = [];
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];

            if (!this._cache[id])
                continue;

            let meta = { id: GLib.Variant.new('s', this._cache[id].id),
                         name: GLib.Variant.new('s', this._cache[id].title) };

            let gicon = this._cache[id].icon;
            let pixbuf = this._cache[id].pixbuf;
            let iconstr = gicon ? gicon.to_string() : null;
            if (iconstr)
                meta['gicon'] = GLib.Variant.new('s', iconstr);
            else if (pixbuf)
                meta['icon-data'] = GdPrivate.create_variant_from_pixbuf(pixbuf);

            metas.push(meta);
        }

        Application.application.release();
        invocation.return_value(GLib.Variant.new('(aa{sv})', [ metas ]));
    },

    GetInitialResultSetAsync: function(params, invocation) {
        let terms = params[0];
        Application.application.hold();

        this._cancellable.cancel();
        this._cancellable.reset();

        let job = new FetchIdsJob(terms);
        job.run(Lang.bind(this,
            function(ids) {
                Application.application.release();
                invocation.return_value(GLib.Variant.new('(as)', [ ids ]));
            }), this._cancellable);
    },

    GetSubsearchResultSetAsync: function(params, invocation) {
        let [previousResults, terms] = params;
        Application.application.hold();

        this._cancellable.cancel();
        this._cancellable.reset();

        let job = new FetchIdsJob(terms);
        job.run(Lang.bind(this,
            function(ids) {
                Application.application.release();
                invocation.return_value(GLib.Variant.new('(as)', [ ids ]));
            }), this._cancellable);
    },

    GetResultMetasAsync: function(params, invocation) {
        let ids = params[0];
        Application.application.hold();

        let toFetch = ids.filter(Lang.bind(this,
            function(id) {
                return !(this._cache[id]);
            }));

        if (toFetch.length > 0) {
            let job = new FetchMetasJob(toFetch);
            job.run(Lang.bind(this,
                function(metas) {
                    // cache the newly fetched results
                    metas.forEach(Lang.bind(this,
                        function(meta) {
                            this._cache[meta.id] = meta;
                        }));

                    this._returnMetasFromCache(ids, invocation);
                }));
        } else {
            this._returnMetasFromCache(ids, invocation);
        }
    },

    ActivateResult: function(id, terms, timestamp) {
        this.emit('activate-result', id, terms, timestamp);
    },

    LaunchSearch: function(terms, timestamp) {
        this.emit('launch-search', terms, timestamp);
    }
});
Signals.addSignalMethods(ShellSearchProvider.prototype);
