/*
 * Copyright (c) 2011, 2012, 2013 Red Hat, Inc.
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
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const GData = imports.gi.GData;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Zpj = imports.gi.Zpj;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Signals = imports.signals;

const Application = imports.application;
const ChangeMonitor = imports.changeMonitor;
const Manager = imports.manager;
const Notifications = imports.notifications;
const Path = imports.path;
const Query = imports.query;
const Search = imports.search;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;

const DeleteItemJob = new Lang.Class({
    Name: 'DeleteItemJob',
// deletes the given resource

    _init: function(urn) {
        this._urn = urn;
    },

    run: function(callback) {
        this._callback = callback;

        let query = Application.queryBuilder.buildDeleteResourceQuery(this._urn);
        Application.connectionQueue.update(query.sparql, null, Lang.bind(this,
            function(object, res) {
                try {
                    object.update_finish(res);
                } catch (e) {
                    log(e);
                }

                if (this._callback)
                    this._callback();
            }));
    }
});


const CollectionIconWatcher = new Lang.Class({
    Name: 'CollectionIconWatcher',

    _init: function(collection) {
        this._collection = collection;
        this._pixbuf = null;

        this._start();
    },

    _clear: function() {
        this._docConnections = {};
        this._urns = [];
        this._docs = [];
    },

    _start: function() {
        this._clear();

        let query = Application.queryBuilder.buildCollectionIconQuery(this._collection.id);
        Application.connectionQueue.add(query.sparql, null, Lang.bind(this,
            function(object, res) {
                let cursor = null;
                try {
                    cursor = object.query_finish(res);
                } catch (e) {
                    log('Unable to query collection items ' + e.toString());
                    return;
                }

                cursor.next_async(null, Lang.bind(this, this._onCursorNext));
            }));
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            log('Unable to query collection items ' + e.toString());
            cursor.close();
            return;
        }

        if (!valid) {
            cursor.close();
            this._onCollectionIconFinished();

            return;
        }

        let urn = cursor.get_string(0)[0];
        this._urns.push(urn);

        cursor.next_async(null, Lang.bind(this, this._onCursorNext));
    },

    _onCollectionIconFinished: function() {
        if (!this._urns.length)
            return;

        // now this._urns has all the URNs of items contained in the collection
        let toQuery = [];

        this._urns.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);
                if (doc)
                    this._docs.push(doc);
                else
                    toQuery.push(urn);
            }));

        this._toQueryRemaining = toQuery.length;
        if (!this._toQueryRemaining) {
            this._allDocsReady();
            return;
        }

        toQuery.forEach(Lang.bind(this,
            function(urn) {
                let job = new TrackerUtils.SingleItemJob(urn, Application.queryBuilder);
                job.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                    function(cursor) {
                        if (cursor) {
                            let doc = Application.documentManager.createDocumentFromCursor(cursor);
                            this._docs.push(doc);
                        }

                        this._toQueryCollector();
                    }));
            }));
    },

    _toQueryCollector: function() {
        this._toQueryRemaining--;

        if (!this._toQueryRemaining)
            this._allDocsReady();
    },

    _allDocsReady: function() {
        this._docs.forEach(Lang.bind(this,
            function(doc) {
                let updateId = doc.connect('info-updated',
                                           Lang.bind(this, this._createCollectionIcon));
                this._docConnections[updateId] = doc;
            }));

        this._createCollectionIcon();
    },

    _createCollectionIcon: function() {
        // now this._docs has an array of Document objects from which we will create the
        // collection icon
        let pixbufs = [];

        this._docs.forEach(
            function(doc) {
                pixbufs.push(doc.origPixbuf);
            });

        this._pixbuf = GdPrivate.create_collection_icon(Utils.getIconSize(), pixbufs);
        this._emitRefresh();
    },

    _emitRefresh: function() {
        this.emit('icon-updated', this._pixbuf);
    },

    destroy: function() {
        for (let id in this._docConnections) {
            let doc = this._docConnections[id];
            doc.disconnect(id);
        }
    },

    refresh: function() {
        this.destroy();
        this._start();
    }
});
Signals.addSignalMethods(CollectionIconWatcher.prototype);

const DocCommon = new Lang.Class({
    Name: 'DocCommon',

    _init: function(cursor) {
        this.id = null;
        this.uri = null;
        this.name = null;
        this.author = null;
        this.mtime = null;
        this.resourceUrn = null;
        this.pixbuf = null;
        this.origPixbuf = null;
        this.defaultAppName = null;

        this.mimeType = null;
        this.rdfType = null;
        this.dateCreated = null;
        this.typeDescription = null;
        this.sourceName = null;

        this.shared = false;

        this.collection = false;
        this._collectionIconWatcher = null;

        this.thumbnailed = false;
        this._thumbPath = null;

        this.populateFromCursor(cursor);

        this._refreshIconId =
            Application.settings.connect('changed::view-as',
                                         Lang.bind(this, this.refreshIcon));
        this._filterId =
            Application.searchCategoryManager.connect('active-changed',
                                                      Lang.bind(this, this.refreshIcon));
    },

    refresh: function() {
        let job = new TrackerUtils.SingleItemJob(this.id, Application.queryBuilder);
        job.run(Query.QueryFlags.NONE, Lang.bind(this,
            function(cursor) {
                if (!cursor)
                    return;

                this.populateFromCursor(cursor);
            }));
    },

    _sanitizeTitle: function() {
        this.name = this.name.replace('Microsoft Word - ', '', 'g');
    },

    populateFromCursor: function(cursor) {
        this.uri = cursor.get_string(Query.QueryColumns.URI)[0];
        this.id = cursor.get_string(Query.QueryColumns.URN)[0];
        this.identifier = cursor.get_string(Query.QueryColumns.IDENTIFIER)[0];
        this.author = cursor.get_string(Query.QueryColumns.AUTHOR)[0];
        this.resourceUrn = cursor.get_string(Query.QueryColumns.RESOURCE_URN)[0];

        let mtime = cursor.get_string(Query.QueryColumns.MTIME)[0];
        if (mtime) {
            let timeVal = GLib.time_val_from_iso8601(mtime)[1];
            this.mtime = timeVal.tv_sec;
        } else {
            this.mtime = Math.floor(GLib.get_real_time() / 1000000);
        }

        this.mimeType = cursor.get_string(Query.QueryColumns.MIMETYPE)[0];
        this.rdfType = cursor.get_string(Query.QueryColumns.RDFTYPE)[0];
        this._updateInfoFromType();

        let dateCreated = cursor.get_string(Query.QueryColumns.DATE_CREATED)[0];
        if (dateCreated) {
            let timeVal = GLib.time_val_from_iso8601(dateCreated)[1];
            this.dateCreated = timeVal.tv_sec;
        } else {
            this.dateCreated = -1;
        }

        // sanitize
        if (!this.uri)
            this.uri = '';

        let title = cursor.get_string(Query.QueryColumns.TITLE)[0];
        let filename = cursor.get_string(Query.QueryColumns.FILENAME)[0];

        if (title && title != '')
            this.name = title;
        else if (filename)
            this.name = GdPrivate.filename_strip_extension(filename);
        else
            this.name = '';

        this._sanitizeTitle();

        this.refreshIcon();
    },

    updateIconFromType: function() {
        let icon = null;

        if (this.mimeType)
            icon = Gio.content_type_get_icon(this.mimeType);

        if (!icon)
            icon = Utils.iconFromRdfType(this.rdfType);

        let iconInfo =
            Gtk.IconTheme.get_default().lookup_by_gicon(icon, Utils.getIconSize(),
                                                        Gtk.IconLookupFlags.FORCE_SIZE |
                                                        Gtk.IconLookupFlags.GENERIC_FALLBACK);

        let pixbuf = null;
        if (iconInfo != null) {
            try {
                pixbuf = iconInfo.load_icon();
            } catch (e) {
                log('Unable to load pixbuf: ' + e.toString());
            }
        }

        this._setOrigPixbuf(pixbuf);
    },

    _refreshCollectionIcon: function() {
        if (!this._collectionIconWatcher) {
            this._collectionIconWatcher = new CollectionIconWatcher(this);

            this._collectionIconWatcher.connect('icon-updated', Lang.bind(this,
                function(watcher, pixbuf) {
                    this._setOrigPixbuf(pixbuf);
                }));
        } else {
            this._collectionIconWatcher.refresh();
        }
    },

    createThumbnail: function(callback) {
        log('Error: DocCommon implementations must override createThumbnail');
    },

    refreshIcon: function() {
        if (this._thumbPath) {
            this._refreshThumbPath();
            return;
        }

        this.updateIconFromType();

        if (this.collection) {
            this._refreshCollectionIcon();
            return;
        }

        if (this._failedThumbnailing)
            return;

        this._file = Gio.file_new_for_uri(this.uri);
        this._file.query_info_async(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
                                    0, 0, null,
                                    Lang.bind(this, this._onFileQueryInfo));
    },

    _onFileQueryInfo: function(object, res) {
        let info = null;
        let haveNewIcon = false;

        try {
            info = object.query_info_finish(res);
        } catch (e) {
            log('Unable to query info for file at ' + this.uri + ': ' + e.toString());
            this._failedThumbnailing = true;
            return;
        }

        this._thumbPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (this._thumbPath) {
            this._refreshThumbPath();
        } else {
            this.thumbnailed = false;
            this.createThumbnail(Lang.bind(this, this._onCreateThumbnail));
        }
    },

    _onCreateThumbnail: function(thumbnailed) {
        if (!thumbnailed) {
            this._failedThumbnailing = true;
            return;
        }

        // get the new thumbnail path
        this._file.query_info_async(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
                                    0, 0, null,
                                    Lang.bind(this, this._onThumbnailPathInfo));
    },

    _onThumbnailPathInfo: function(object, res) {
        let info = null;

        try {
            info = object.query_info_finish(res);
        } catch (e) {
            log('Unable to query info for file at ' + this.uri + ': ' + e.toString());
            this._failedThumbnailing = true;
            return;
        }

        this._thumbPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (this._thumbPath)
            this._refreshThumbPath();
        else
            this._failedThumbnailing = true;
    },

    _refreshThumbPath: function() {
        let thumbFile = Gio.file_new_for_path(this._thumbPath);

        thumbFile.read_async(GLib.PRIORITY_DEFAULT, null, Lang.bind(this,
            function(object, res) {
                try {
                    let stream = object.read_finish(res);
                    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,
                        Utils.getIconSize(), Utils.getIconSize(),
                        true, null, Lang.bind(this,
                            function(object, res) {
                                try {
                                    let pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
                                    this.thumbnailed = true;
                                    this._setOrigPixbuf(pixbuf);
                                } catch (e) {
                                    this._failedThumbnailing = true;
                                }

                                // close the underlying stream immediately
                                stream.close_async(0, null, null);
                            }));
                } catch (e) {
                    this._failedThumbnailing = true;
                }
            }));
    },

    _updateInfoFromType: function() {
        if (this.rdfType.indexOf('nfo#DataContainer') != -1)
            this.collection = true;

        this.updateTypeDescription();
    },

    _createSymbolicEmblem: function(name) {
        let pix = Gd.create_symbolic_icon(name, Utils.getIconSize());

        if (!pix)
            pix = new Gio.ThemedIcon({ name: name });

        return pix;
    },

    _setOrigPixbuf: function(pixbuf) {
        if (pixbuf) {
            this.origPixbuf = pixbuf;
        }

        this._checkEffectsAndUpdateInfo();
    },

    _checkEffectsAndUpdateInfo: function() {
        let emblemIcons = [];
        let emblemedPixbuf = null;
        let activeItem;

        activeItem = Application.searchCategoryManager.getActiveItem();

        if (this.shared &&
            (!activeItem ||
             (activeItem.id != Search.SearchCategoryStock.SHARED)))
            emblemIcons.push(this._createSymbolicEmblem('emblem-shared'));

        if (emblemIcons.length > 0) {
            let emblemedIcon = new Gio.EmblemedIcon({ gicon: this.origPixbuf });

            emblemIcons.forEach(
                function(emblemIcon) {
                    let emblem = new Gio.Emblem({ icon: emblemIcon });
                    emblemedIcon.add_emblem(emblem);
                });

            let theme = Gtk.IconTheme.get_default();

            try {
                let iconInfo = theme.lookup_by_gicon(emblemedIcon,
                                                     Math.max(this.origPixbuf.get_width(),
                                                              this.origPixbuf.get_height()),
                                                     Gtk.IconLookupFlags.FORCE_SIZE);

                emblemedPixbuf = iconInfo.load_icon();
            } catch (e) {
                log('Unable to render the emblem: ' + e.toString());
            }
        } else {
            emblemedPixbuf = this.origPixbuf;
        }

        let thumbnailedPixbuf = null;

        if (this.thumbnailed) {
            let [ slice, border ] = Utils.getThumbnailFrameBorder();
            thumbnailedPixbuf = Gd.embed_image_in_frame(emblemedPixbuf,
                'resource:///org/gnome/documents/thumbnail-frame.png',
                slice, border);
        } else {
            thumbnailedPixbuf = emblemedPixbuf;
        }

        this.pixbuf = thumbnailedPixbuf;

        this.emit('info-updated');
    },

    destroy: function() {
        if (this._collectionIconWatcher) {
            this._collectionIconWatcher.destroy();
            this._collectionIconWatcher = null;
        }

        Application.settings.disconnect(this._refreshIconId);
        Application.searchCategoryManager.disconnect(this._filterId);
    },

    open: function(screen, timestamp) {
        try {
            Gtk.show_uri(screen, this.uri, timestamp);
        } catch (e) {
            log('Unable to show URI ' + this.uri + ': ' + e.toString());
        }
    },

    print: function(toplevel) {
        this.load(null, null, Lang.bind(this,
            function(doc, docModel, error) {
                if (error) {
                    log('Unable to print document ' + this.uri + ': ' + error);
                    return;
                }

                let printOp = EvView.PrintOperation.new(docModel.get_document());
                printOp.connect('done', Lang.bind(this,
                    function(op, res) {
                        if (res == Gtk.PrintOperationResult.APPLY)
                            Application.selectionController.setSelectionMode(false);
                    }));

                let printNotification = new Notifications.PrintNotification(printOp, doc);

                printOp.run(toplevel);
            }));
    },

    getWhere: function() {
        let retval = '';

        if (this.collection)
            retval = '{ ?urn nie:isPartOf <' + this.id + '> }';

        return retval;
    },

    isLocal: function() {
        return false;
    }
});
Signals.addSignalMethods(DocCommon.prototype);

const LocalDocument = new Lang.Class({
    Name: 'LocalDocument',
    Extends: DocCommon,

    _init: function(cursor) {
        this._failedThumbnailing = false;

        this.parent(cursor);

        this.sourceName = _("Local");

        let defaultApp = null;
        if (this.mimeType)
            defaultApp = Gio.app_info_get_default_for_type(this.mimeType, true);

        if (defaultApp)
            this.defaultAppName = defaultApp.get_name();
    },

    populateFromCursor: function(cursor) {
        this.parent(cursor);

        if (!Application.application.gettingStartedLocation)
            return;

        let file = Gio.File.new_for_uri(this.uri);
        if (file.has_parent(Application.application.gettingStartedLocation)) {
            // Translators: Documents ships a "Getting Started with Documents"
            // tutorial PDF. The "GNOME" string below is displayed as the author name
            // of that document, and doesn't normally need to be translated.
            this.author = _("GNOME");
            this.name = this.title = _("Getting Started with Documents");
        }
    },

    createThumbnail: function(callback) {
        GdPrivate.queue_thumbnail_job_for_file_async(this._file, Lang.bind(this,
            function(object, res) {
                let thumbnailed = GdPrivate.queue_thumbnail_job_for_file_finish(res);
                callback(thumbnailed);
            }));
    },

    updateTypeDescription: function() {
        let description = '';

        if (this.collection)
            description = _("Collection");
        else if (this.mimeType)
            description = Gio.content_type_get_description(this.mimeType);

        this.typeDescription = description;
    },

    load: function(passwd, cancellable, callback) {
        GdPrivate.pdf_loader_load_uri_async(this.uri, passwd, cancellable, Lang.bind(this,
            function(source, res) {
                try {
                    let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                    callback(this, docModel, null);
                } catch (e) {
                    callback(this, null, e);
                }
            }));
    },

    canTrash: function() {
        return this.collection;
    },

    trash: function() {
        if (this.collection) {
            let job = new DeleteItemJob(this.id);
            job.run(null);
        }
    },

    isLocal: function() {
        return true;
    }
});

const _GOOGLE_DOCS_SCHEME_LABELS = "http://schemas.google.com/g/2005/labels";
const _GOOGLE_DOCS_TERM_STARRED = "http://schemas.google.com/g/2005/labels#starred";

const GoogleDocument = new Lang.Class({
    Name: 'GoogleDocument',
    Extends: DocCommon,

    _init: function(cursor) {
        this._failedThumbnailing = false;

        this.parent(cursor);

        // overridden
        this.defaultAppName = _("Google Docs");
        this.sourceName = _("Google");
    },

    _createGDataEntry: function(cancellable, callback) {
        let source = Application.sourceManager.getItemById(this.resourceUrn);

        let authorizer = new GData.GoaAuthorizer({ goa_object: source.object });
        let service = new GData.DocumentsService({ authorizer: authorizer });

        service.query_single_entry_async
            (service.get_primary_authorization_domain(),
             this.identifier, null,
             GData.DocumentsText,
             cancellable, Lang.bind(this,
                 function(object, res) {
                     let entry = null;
                     let exception = null;

                     try {
                         entry = object.query_single_entry_finish(res);
                     } catch (e) {
                         exception = e;
                     }

                     callback(entry, service, exception);
                 }));
    },

    load: function(passwd, cancellable, callback) {
        this._createGDataEntry(cancellable, Lang.bind(this,
            function(entry, service, exception) {
                if (exception) {
                    // try loading from the most recent cache, if any
                    GdPrivate.pdf_loader_load_uri_async(this.identifier, cancellable, Lang.bind(this,
                        function(source, res) {
                            try {
                                let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                                callback(this, docModel, null);
                            } catch (e) {
                                // report the outmost error only
                                callback(this, null, exception);
                            }
                        }));

                    return;
                }

                GdPrivate.pdf_loader_load_gdata_entry_async
                    (entry, service, cancellable, Lang.bind(this,
                        function(source, res) {
                            try {
                                let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                                callback(this, docModel, null);
                            } catch (e) {
                                callback(this, null, e);
                            }
                        }));
            }));
    },

    createThumbnail: function(callback) {
        this._createGDataEntry(null, Lang.bind(this,
            function(entry, service, exception) {
                if (exception) {
                    callback(false);
                    return;
                }

                let uri = entry.get_thumbnail_uri();
                if (!uri) {
                    callback(false);
                    return;
                }

                let authorizationDomain = service.get_primary_authorization_domain();
                let inputStream = new GData.DownloadStream({ service: service,
                                                             authorization_domain: authorizationDomain,
                                                             download_uri: uri });

                let checksum = new GLib.Checksum(GLib.ChecksumType.MD5);
                checksum.update(this.uri, -1);
                let basename = checksum.get_string() + '.png';
                let path = GLib.build_filenamev([GLib.get_user_cache_dir(), "thumbnails", "normal", basename]);

                let downloadFile = Gio.File.new_for_path(path);
                downloadFile.replace_async
                    (null, false, Gio.FileCreateFlags.PRIVATE, GLib.PRIORITY_DEFAULT, null, Lang.bind(this,
                        function(source, res) {
                            let outputStream;

                            try {
                                outputStream = downloadFile.replace_finish(res);
                            } catch (e) {
                                callback(false);
                                return;
                            }

                            outputStream.splice_async(inputStream,
                                Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                                GLib.PRIORITY_DEFAULT, null, Lang.bind(this,
                                    function(source, res) {
                                        try {
                                            outputStream.splice_finish(res);
                                        } catch (e) {
                                            callback(false);
                                            return;
                                        }

                                        callback(true);
                                    }));
                        }));
            }));
    },

    updateTypeDescription: function() {
        let description;

        if (this.collection)
            description = _("Collection");
        else if (this.rdfType.indexOf('nfo#Spreadsheet') != -1)
            description = _("Spreadsheet");
        else if (this.rdfType.indexOf('nfo#Presentation') != -1)
            description = _("Presentation");
        else
            description = _("Document");

        this.typeDescription = description;
    },

    populateFromCursor: function(cursor) {
        this.shared = cursor.get_boolean(Query.QueryColumns.SHARED);

        this.parent(cursor);
    },

    canTrash: function() {
        return false;
    }
});

const OwncloudDocument = new Lang.Class({
    Name: 'OwncloudDocument',
    Extends: DocCommon,

    _init: function(cursor) {
        this._failedThumbnailing = true;

        this.parent(cursor);

        // overridden
        this.sourceName = _("ownCloud");

        let defaultApp = null;
        if (this.mimeType)
            defaultApp = Gio.app_info_get_default_for_type(this.mimeType, true);

        if (defaultApp)
            this.defaultAppName = defaultApp.get_name();
    },

    createThumbnail: function(callback) {
        GdPrivate.queue_thumbnail_job_for_file_async(this._file, Lang.bind(this,
            function(object, res) {
                let thumbnailed = GdPrivate.queue_thumbnail_job_for_file_finish(res);
                callback(thumbnailed);
            }));
    },

    updateTypeDescription: function() {
        let description = '';

        if (this.collection)
            description = _("Collection");
        else if (this.mimeType)
            description = Gio.content_type_get_description(this.mimeType);

        this.typeDescription = description;
    },

    load: function(passwd, cancellable, callback) {
        GdPrivate.pdf_loader_load_uri_async(this.uri, passwd, cancellable, Lang.bind(this,
            function(source, res) {
                try {
                    let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                    callback(this, docModel, null);
                } catch (e) {
                    callback(this, null, e);
                }
            }));
    },

    canTrash: function() {
        return false;
    }
});

const SkydriveDocument = new Lang.Class({
    Name: 'SkydriveDocument',
    Extends: DocCommon,

    _init: function(cursor) {
        this._failedThumbnailing = true;

        this.parent(cursor);

        // overridden
        this.defaultAppName = _("Skydrive");
        this.sourceName = _("Skydrive");
    },

    _createZpjEntry: function(cancellable, callback) {
        let source = Application.sourceManager.getItemById(this.resourceUrn);

        let authorizer = new Zpj.GoaAuthorizer({ goa_object: source.object });
        let service = new Zpj.Skydrive({ authorizer: authorizer });

        const zpj_prefix = "windows-live:skydrive:";
        let zpj_id = this.identifier.substring(zpj_prefix.length);

        service.query_info_from_id_async
            (zpj_id, cancellable,
             Lang.bind(this,
                 function(object, res) {
                     let entry = null;
                     let exception = null;

                     try {
                         entry = object.query_info_from_id_finish(res);
                     } catch (e) {
                         exception = e;
                     }

                     callback(entry, service, exception);
                 }));
    },

    load: function(passwd, cancellable, callback) {
        this._createZpjEntry(cancellable, Lang.bind(this,
            function(entry, service, exception) {
                if (exception) {
                    // try loading from the most recent cache, if any
                    GdPrivate.pdf_loader_load_uri_async(this.identifier, cancellable, Lang.bind(this,
                        function(source, res) {
                            try {
                                let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                                callback(this, docModel, null);
                            } catch (e) {
                                // report the outmost error only
                                callback(this, null, exception);
                            }
                        }));

                    return;
                }

                GdPrivate.pdf_loader_load_zpj_entry_async
                    (entry, service, cancellable, Lang.bind(this,
                        function(source, res) {
                            try {
                                let docModel = GdPrivate.pdf_loader_load_zpj_entry_finish(res);
                                callback(this, docModel, null);
                            } catch (e) {
                                callback(this, null, e);
                            }
                        }));
            }));
    },

    updateTypeDescription: function() {
        let description;

        if (this.collection)
            description = _("Collection");
        else if (this.rdfType.indexOf('nfo#Spreadsheet') != -1)
            description = _("Spreadsheet");
        else if (this.rdfType.indexOf('nfo#Presentation') != -1)
            description = _("Presentation");
        else
            description = _("Document");

        this.typeDescription = description;
    },

    canTrash: function() {
        return false;
    }
});

const DocumentManager = new Lang.Class({
    Name: 'DocumentManager',
    Extends: Manager.BaseManager,

    _init: function() {
        this.parent();

        this._activeDocModel = null;
        this._activeDocModelIds = [];
        this._loaderCancellable = null;

        // a stack containing the collections which were used to
        // navigate to the active document or collection
        this._collectionPath = [];

        Application.changeMonitor.connect('changes-pending',
                                          Lang.bind(this, this._onChangesPending));
    },

    _onChangesPending: function(monitor, changes) {
        for (let idx in changes) {
            let changeEvent = changes[idx];

            if (changeEvent.type == ChangeMonitor.ChangeEventType.CHANGED) {
                let doc = this.getItemById(changeEvent.urn);

                if (doc)
                    doc.refresh();
            } else if (changeEvent.type == ChangeMonitor.ChangeEventType.CREATED) {
                this._onDocumentCreated(changeEvent.urn);
            } else if (changeEvent.type == ChangeMonitor.ChangeEventType.DELETED) {
                let doc = this.getItemById(changeEvent.urn);

                if (doc) {
                    doc.destroy();
                    this.removeItemById(changeEvent.urn);

                    if (doc.collection)
                        Application.collectionManager.removeItemById(changeEvent.urn);
                }
            }
        }
    },

    _onDocumentCreated: function(urn) {
        let job = new TrackerUtils.SingleItemJob(urn, Application.queryBuilder);
        job.run(Query.QueryFlags.NONE, Lang.bind(this,
            function(cursor) {
                if (!cursor)
                    return;

                this.addDocumentFromCursor(cursor);
            }));
    },

    _identifierIsGoogle: function(identifier) {
        return (identifier &&
                (identifier.indexOf('https://docs.google.com') != -1));
    },

    _identifierIsOwncloud: function(identifier) {
        return (identifier &&
                (identifier.indexOf('owncloud:') != -1));
    },

    _identifierIsSkydrive: function(identifier) {
        return (identifier &&
                (identifier.indexOf('windows-live:skydrive:') != -1));
    },

    createDocumentFromCursor: function(cursor) {
        let identifier = cursor.get_string(Query.QueryColumns.IDENTIFIER)[0];
        let doc;

        if (this._identifierIsGoogle(identifier))
            doc = new GoogleDocument(cursor);
        else if (this._identifierIsOwncloud(identifier))
            doc = new OwncloudDocument(cursor);
        else if (this._identifierIsSkydrive(identifier))
            doc = new SkydriveDocument(cursor);
        else
            doc = new LocalDocument(cursor);

        return doc;
    },

    addDocumentFromCursor: function(cursor) {
        let doc = this.createDocumentFromCursor(cursor);
        this.addItem(doc);

        if (doc.collection)
            Application.collectionManager.addItem(doc);

        return doc;
    },

    clear: function() {
        let items = this.getItems();
        for (let idx in items) {
            items[idx].destroy();
        };

        this.parent();
    },

    _humanizeError: function(error) {
        let message = error.message;
        if (error.domain == GData.ServiceError) {
            switch (error.code) {
            case GData.ServiceError.NETWORK_ERROR:
                message = _("Please check the network connection.");
                break;
            case GData.ServiceError.PROXY_ERROR:
                message = _("Please check the network proxy settings.");
                break;
            case GData.ServiceError.AUTHENTICATION_REQUIRED:
                message = _("Unable to sign in to the document service.");
                break;
            case GData.ServiceError.NOT_FOUND:
                message = _("Unable to locate this document.");
                break;
            default:
                message = _("Hmm, something is fishy (%d).").format(error.code);
                break;
            }
        }
        let exception = new GLib.Error(error.domain, error.code, message);
        return exception;
    },

    _onDocumentLoadError: function(doc, error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return;

        if (error.matches(EvDocument.DocumentError, EvDocument.DocumentError.ENCRYPTED)) {
            this.emit('password-needed', doc);
            return;
        }

        // Translators: %s is the title of a document
        let message = _("Oops! Unable to load “%s”").format(doc.name);
        let exception = this._humanizeError(error);
        this.emit('load-error', doc, message, exception);
    },

    _onDocumentLoaded: function(doc, docModel, error) {
        this._loaderCancellable = null;

        if (error) {
            this._onDocumentLoadError(doc, error);
            return;
        }

        // save loaded model and signal
        this._activeDocModel = docModel;
        this._activeDocModel.set_continuous(false);

        // load metadata
        this._connectMetadata(docModel);

        this.emit('load-finished', doc, docModel);
    },

    reloadActiveItem: function(passwd) {
        let doc = this.getActiveItem();

        if (!doc)
            return;

        if (doc.collection)
            return;

        // cleanup any state we have for previously loaded model
        this._clearActiveDocModel();

        this._loaderCancellable = new Gio.Cancellable();
        doc.load(passwd, this._loaderCancellable, Lang.bind(this, this._onDocumentLoaded));
        this.emit('load-started', doc);
    },

    setActiveItem: function(doc) {
        if (!this.parent(doc))
            return;

        // cleanup any state we have for previously loaded model
        this._clearActiveDocModel();

        if (!doc)
            return;

        if (doc.collection) {
            this._collectionPath.push(Application.collectionManager.getActiveItem());
            Application.collectionManager.setActiveItem(doc);
            return;
        }

        let recentManager = Gtk.RecentManager.get_default();
        recentManager.add_item(doc.uri);

        this._loaderCancellable = new Gio.Cancellable();
        doc.load(null, this._loaderCancellable, Lang.bind(this, this._onDocumentLoaded));
        this.emit('load-started', doc);
    },

    activatePreviousCollection: function() {
        this._clearActiveDocModel();
        Application.collectionManager.setActiveItem(this._collectionPath.pop());
    },

    _clearActiveDocModel: function() {
        // cancel any pending load operation
        if (this._loaderCancellable) {
            this._loaderCancellable.cancel();
            this._loaderCancellable = null;
        }

        // clear any previously loaded document model
        if (this._activeDocModel) {
            this._activeDocModelIds.forEach(Lang.bind(this,
                function(id) {
                    this._activeDocModel.disconnect(id);
                }));

            this.metadata = null;
            this._activeDocModel = null;
            this._activeDocModelIds = [];
        }
    },

    _connectMetadata: function(docModel) {
        let evDoc = docModel.get_document();
        let file = Gio.File.new_for_uri(evDoc.get_uri());
        if (!GdPrivate.is_metadata_supported_for_file(file))
            return;

        this.metadata = new GdPrivate.Metadata({ file: file });

        // save current page in metadata
        let [res, val] = this.metadata.get_int('page');
        if (res)
            docModel.set_page(val);
        this._activeDocModelIds.push(
            docModel.connect('page-changed', Lang.bind(this,
                function(source, oldPage, newPage) {
                    this.metadata.set_int('page', newPage);
                }))
        );
    }
});
