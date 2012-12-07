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
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const Lang = imports.lang;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const _ = imports.gettext.gettext;

const Global = imports.global;
const Manager = imports.manager;

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
        locations = locations.concat(this._getTrackerLocations());

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

    _init: function() {
        this.parent(_("Sources"));

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

        Global.goaClient.connect('account-added', Lang.bind(this, this._refreshGoaAccounts));
        Global.goaClient.connect('account-changed', Lang.bind(this, this._refreshGoaAccounts));
        Global.goaClient.connect('account-removed', Lang.bind(this, this._refreshGoaAccounts));

        this._refreshGoaAccounts();
        this.setActiveItemById(SourceStock.ALL);
    },

    _refreshGoaAccounts: function() {
        let newItems = {};
        let accounts = Global.goaClient.get_accounts();

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
        let found = false;
        this.forEachItem(Lang.bind(this,
            function(source) {
                if (!source.object)
                    return;

                let account = source.object.get_account();
                if (!account)
                    return;

                if (found)
                    return;

                if (account.provider_type == providerType)
                    found = true;
            }));

        return found;
    }
});
