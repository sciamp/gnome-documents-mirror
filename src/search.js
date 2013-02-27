/*
 * Copyright (c) 2011, 2012 Red Hat, Inc.
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

const Application = imports.application;
const Manager = imports.manager;
const Query = imports.query;

const Lang = imports.lang;
const Signals = imports.signals;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Tracker = imports.gi.Tracker;
const _ = imports.gettext.gettext;

function initSearch(context) {
    context.collectionManager = new Manager.BaseManager(context);
    context.sourceManager = new SourceManager(context);
    context.searchCategoryManager = new SearchCategoryManager(context);
    context.searchMatchManager = new SearchMatchManager(context);
    context.searchTypeManager = new SearchTypeManager(context);
    context.searchController = new SearchController(context);
    context.offsetController = new OffsetController(context);
    context.queryBuilder = new Query.QueryBuilder(context);
};

const SearchController = new Lang.Class({
    Name: 'SearchController',

    _init: function() {
        this._string = '';
    },

    setString: function(string) {
        if (this._string == string)
            return;

        this._string = string;
        this.emit('search-string-changed', this._string);
    },

    getString: function() {
        return this._string;
    },

    getTerms: function() {
        let str = Tracker.sparql_escape_string(this._string);
        return str.replace(/ +/g, ' ').split(' ');
    }
});
Signals.addSignalMethods(SearchController.prototype);

const SearchCategoryStock = {
    ALL: 'all',
    FAVORITES: 'favorites',
    SHARED: 'shared',
    PRIVATE: 'private'
};

const SearchCategory = new Lang.Class({
    Name: 'SearchCategory',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this.icon = params.icon;
    },

    getWhere: function() {
        if (this.id == SearchCategoryStock.FAVORITES)
            return '{ ?urn nao:hasTag nao:predefined-tag-favorite }';

        // require to have a contributor, and creator, and they should be different
        if (this.id == SearchCategoryStock.SHARED)
            return '{ ?urn nco:contributor ?contributor . ?urn nco:creator ?creator FILTER (?contributor != ?creator ) }';

        return '';
    },

    getFilter: function() {
        // require to be not local
        if (this.id == SearchCategoryStock.SHARED)
            return this._manager.context.sourceManager.getFilterNotLocal();

        return '(true)';
    }
});

const SearchCategoryManager = new Lang.Class({
    Name: 'SearchCategoryManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        this.parent(_("Category"), context);

        let category, recent;
        // Translators: this refers to new and recent documents
        recent = new SearchCategory({ id: SearchCategoryStock.ALL,
                                      name: _("All"),
                                      icon: '' });
        this.addItem(recent);

        // Translators: this refers to favorite documents
        category = new SearchCategory({ id: SearchCategoryStock.FAVORITES,
                                        name: _("Favorites"),
                                        icon: 'emblem-favorite-symbolic' });
        this.addItem(category);
        // Translators: this refers to shared documents
        category = new SearchCategory({ id: SearchCategoryStock.SHARED,
                                        name: _("Shared with you"),
                                        icon: 'emblem-shared-symbolic' });
        this.addItem(category);

        // Private category: currently unimplemented
        // category = new SearchCategory(SearchCategoryStock.PRIVATE, _("Private"), 'channel-secure-symbolic');
        // this._categories[category.id] = category;

        this.setActiveItem(recent);
    }
});

const SearchType = new Lang.Class({
    Name: 'SearchType',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._filter = (params.filter) ? (params.filter) : '(true)';
        this._where = (params.where) ? (params.where) : '';
    },

    getFilter: function() {
        return this._filter;
    },

    getWhere: function() {
        return this._where;
    }
});

const SearchTypeManager = new Lang.Class({
    Name: 'SearchTypeManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: "Type" refers to a search filter on the document type
        // (PDF, spreadsheet, ...)
        this.parent(_("Type"), context);

        this.addItem(new SearchType({ id: 'all',
                                      name: _("All") }));
        this.addItem(new SearchType({ id: 'collections',
                                      name: _("Collections"),
                                      filter: 'fn:starts-with(nao:identifier(?urn), \"gd:collection\")',
                                      where: '?urn rdf:type nfo:DataContainer .' }));
        this.addItem(new SearchType({ id: 'pdf',
                                      name: _("PDF Documents"),
                                      filter: 'fn:contains(nie:mimeType(?urn), \"application/pdf\")',
                                      where: '?urn rdf:type nfo:PaginatedTextDocument .' }));
        this.addItem(new SearchType({ id: 'presentations',
                                      name: _("Presentations"),
                                      where: '?urn rdf:type nfo:Presentation .' }));
        this.addItem(new SearchType({ id: 'spreadsheets',
                                      name: _("Spreadsheets"),
                                      where: '?urn rdf:type nfo:Spreadsheet .' }));
        this.addItem(new SearchType({ id: 'textdocs',
                                      name: _("Text Documents"),
                                      where: '?urn rdf:type nfo:PaginatedTextDocument .' }));

        this.setActiveItemById('all');
    },

    getCurrentTypes: function() {
        let activeItem = this.getActiveItem();

        if (activeItem.id == 'all')
            return this.getAllTypes();

        return [ activeItem ];
    },

    getAllTypes: function() {
        let types = [];

        this.forEachItem(function(item) {
            if (item.id != 'all')
                types.push(item);
            });

        return types;
    }
});

const SearchMatchStock = {
    ALL: 'all',
    TITLE: 'title',
    AUTHOR: 'author'
};

const SearchMatch = new Lang.Class({
    Name: 'SearchMatch',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._term = '';
    },

    setFilterTerm: function(term) {
        this._term = term;
    },

    getFilter: function() {
        if (this.id == SearchMatchStock.TITLE)
            return ('fn:contains ' +
                    '(fn:lower-case (tracker:coalesce(nie:title(?urn), nfo:fileName(?urn))), ' +
                    '"%s")').format(this._term);
        if (this.id == SearchMatchStock.AUTHOR)
            return ('fn:contains ' +
                    '(fn:lower-case (tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher))), ' +
                    '"%s")').format(this._term);
        return '';
    }
});

const SearchMatchManager = new Lang.Class({
    Name: 'SearchMatchManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: this is a verb that refers to "All", "Title" and "Author",
        // as in "Match All", "Match Title" and "Match Author"
        this.parent(_("Match"), context);

        this.addItem(new SearchMatch({ id: SearchMatchStock.ALL,
                                       name: _("All") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.TITLE,
        //Translators: "Title" refers to "Match Title" when searching
                                       name: _("Title") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.AUTHOR,
        //Translators: "Author" refers to "Match Author" when searching
                                       name: _("Author") }));

        this.setActiveItemById(SearchMatchStock.ALL);
    },

    getFilter: function() {
        let terms = this.context.searchController.getTerms();
        let filters = [];

        for (let i = 0; i < terms.length; i++) {
            this.forEachItem(function(item) {
                item.setFilterTerm(terms[i]);
            });
            filters.push(this.parent());
        }
        return filters.length ? '( ' + filters.join(' && ') + ')' : '';
    }
});

const SourceStock = {
    ALL: 'all',
    LOCAL: 'local'
};

const TRACKER_SCHEMA = 'org.freedesktop.Tracker.Miner.Files';
const TRACKER_KEY_RECURSIVE_DIRECTORIES = 'index-recursive-directories';

const Source = new Lang.Class({
    Name: 'Source',

    _init: function(params) {
        this.id = null;
        this.name = null;
        this.icon = null;

        if (params.object) {
            this.object = params.object;
            let account = params.object.get_account();

            this.id = 'gd:goa-account:' + account.id;
            this.name = account.provider_name;
            this.icon = Gio.icon_new_for_string(account.provider_icon);
        } else {
            this.id = params.id;
            this.name = params.name;
        }

        this.builtin = params.builtin;
    },

    _getGettingStartedLocations: function() {
        if (Application.application.gettingStartedLocation)
            return Application.application.gettingStartedLocation;
        else
            return [];
    },

    _getTrackerLocations: function() {
        let settings = new Gio.Settings({ schema: TRACKER_SCHEMA });
        let locations = settings.get_strv(TRACKER_KEY_RECURSIVE_DIRECTORIES);
        let files = [];

        locations.forEach(Lang.bind(this,
            function(location) {
                // ignore special XDG placeholders, since we handle those internally
                if (location[0] == '&' || location[0] == '$')
                    return;

                let trackerFile = Gio.file_new_for_commandline_arg(location);

                // also ignore XDG locations if they are present with their full path
                for (let idx = 0; idx < GLib.UserDirectory.N_DIRECTORIES; idx++) {
                    let file = Gio.file_new_for_path(GLib.get_user_special_dir(idx));
                    if (trackerFile.equal(file))
                        return;
                }

                files.push(trackerFile);
            }));

        return files;
    },

    _getBuiltinLocations: function() {
        let files = [];
        let xdgDirs = [GLib.UserDirectory.DIRECTORY_DESKTOP,
                       GLib.UserDirectory.DIRECTORY_DOCUMENTS,
                       GLib.UserDirectory.DIRECTORY_DOWNLOAD];

        xdgDirs.forEach(Lang.bind(this,
            function(dir) {
                let path = GLib.get_user_special_dir(dir);
                if (path)
                    files.push(Gio.file_new_for_path(path));
            }));

        return files;
    },

    _buildFilterLocal: function() {
        let locations = this._getBuiltinLocations();
        locations = locations.concat(
            this._getTrackerLocations(),
            this._getGettingStartedLocations());

        let filters = [];
        locations.forEach(Lang.bind(this,
            function(location) {
                filters.push('(fn:contains (nie:url(?urn), "%s"))'.format(location.get_uri()));
            }));

        filters.push('(fn:starts-with (nao:identifier(?urn), "gd:collection:local:"))');

        return '(' + filters.join(' || ') + ')';
    },

    getFilter: function() {
        let filters = [];

        if (this.id == SourceStock.LOCAL) {
            filters.push(this._buildFilterLocal());
        } else if (this.id == SourceStock.ALL) {
            filters.push(this._buildFilterLocal());
            filters.push(this._manager.getFilterNotLocal());
        } else {
            filters.push(this._buildFilterResource());
        }

        return '(' + filters.join(' || ') + ')';
    },

    _buildFilterResource: function() {
        let filter = '(false)';

        if (!this.builtin)
            filter = ('(nie:dataSource(?urn) = "%s")').format(this.id);

        return filter;
    }
});

const SourceManager = new Lang.Class({
    Name: 'SourceManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        this.parent(_("Sources"), context);

        // Translators: this refers to documents
        let source = new Source({ id: SourceStock.ALL,
                                  name: _("All"),
                                  builtin: true });
        this.addItem(source);

        // Translators: this refers to local documents
        source = new Source({ id: SourceStock.LOCAL,
                              name: _("Local"),
                              builtin: true });
        this.addItem(source);

        Application.goaClient.connect('account-added', Lang.bind(this, this._refreshGoaAccounts));
        Application.goaClient.connect('account-changed', Lang.bind(this, this._refreshGoaAccounts));
        Application.goaClient.connect('account-removed', Lang.bind(this, this._refreshGoaAccounts));

        this._refreshGoaAccounts();
        this.setActiveItemById(SourceStock.ALL);
    },

    _refreshGoaAccounts: function() {
        let newItems = {};
        let accounts = Application.goaClient.get_accounts();

        accounts.forEach(Lang.bind(this,
            function(object) {
                if (!object.get_account())
                    return;

                if (!object.get_documents())
                    return;

                let source = new Source({ object: object });
                newItems[source.id] = source;
            }));

        this.processNewItems(newItems);
    },

    getFilterNotLocal: function() {
        let sources = this.getItems();
        let filters = [];

        for (idx in sources) {
            let source = sources[idx];
            if (!source.builtin)
                filters.push(source.getFilter());
        }

        if (filters.length == 0)
            filters.push('false');

        return '(' + filters.join(' || ') + ')';
    },

    hasOnlineSources: function() {
        let hasOnline = false;
        this.forEachItem(
            function(source) {
                if (source.object)
                    hasOnline = true;
            });

        return hasOnline;
    },

    hasProviderType: function(providerType) {
        let items = this.getForProviderType(providerType);
        return (items.length > 0);
    },

    getForProviderType: function(providerType) {
        let items = [];
        this.forEachItem(Lang.bind(this,
            function(source) {
                if (!source.object)
                    return;

                let account = source.object.get_account();
                if (account.provider_type == providerType)
                    items.push(source);
            }));

        return items;
    }
});

const _OFFSET_STEP = 50;

const OffsetController = new Lang.Class({
    Name: 'OffsetController',

    _init: function(context) {
        this._offset = 0;
        this._itemCount = 0;
        this._context = context;
    },

    // to be called by the view
    increaseOffset: function() {
        this._offset += _OFFSET_STEP;
        this.emit('offset-changed', this._offset);
    },

    // to be called by the model
    resetItemCount: function() {
        let query = this._context.queryBuilder.buildCountQuery();

        Application.connectionQueue.add
            (query.sparql, null, Lang.bind(this,
                function(object, res) {
                    let cursor = null;
                    try {
                        cursor = object.query_finish(res);
                    } catch (e) {
                        log('Unable to execute count query: ' + e.toString());
                        return;
                    }

                    cursor.next_async(null, Lang.bind(this,
                        function(object, res) {
                            let valid = object.next_finish(res);

                            if (valid) {
                                this._itemCount = cursor.get_integer(0);
                                this.emit('item-count-changed', this._itemCount);
                            }

                            cursor.close();
                        }));
                }));
    },

    // to be called by the model
    resetOffset: function() {
        this._offset = 0;
    },

    getItemCount: function() {
        return this._itemCount;
    },

    getRemainingDocs: function() {
        return (this._itemCount - (this._offset + _OFFSET_STEP));
    },

    getOffsetStep: function() {
        return _OFFSET_STEP;
    },

    getOffset: function() {
        return this._offset;
    }
});
Signals.addSignalMethods(OffsetController.prototype);
