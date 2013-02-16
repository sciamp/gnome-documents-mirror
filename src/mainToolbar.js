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

const Gd = imports.gi.Gd;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;

const Gettext = imports.gettext;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Searchbar = imports.searchbar;

const MainToolbar = new Lang.Class({
    Name: 'MainToolbar',

    _init: function() {
        this._model = null;

        this.widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        this.widget.show();

        this.toolbar = new Gd.MainToolbar({ icon_size: Gtk.IconSize.MENU });
        this.toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_MENUBAR);
        this.widget.add(this.toolbar);
        this.toolbar.show();

        this._searchbar = this.createSearchbar();
        if (this._searchbar)
            this.widget.add(this._searchbar.widget);
    },

    handleEvent: function(event) {
        let res = this._searchbar.handleEvent(event);
        return res;
    },

    addSearchButton: function() {
        let searchButton =
            this.toolbar.add_toggle('edit-find-symbolic', _("Search"), false);
        searchButton.action_name = 'app.search';
    }
});

const OverviewToolbar = new Lang.Class({
    Name: 'OverviewToolbar',
    Extends: MainToolbar,

    _init: function(overlay) {
        this._overlay = overlay;
        this._collBackButton = null;
        this._collectionId = 0;
        this._selectionChangedId = 0;

        this.parent();

        // setup listeners to mode changes that affect the toolbar layout
        this._searchStringId = Application.searchController.connect('search-string-changed',
            Lang.bind(this, this._setToolbarTitle));
        this._searchTypeId = Application.searchTypeManager.connect('active-changed',
            Lang.bind(this, this._setToolbarTitle));
        this._searchMatchId = Application.searchMatchManager.connect('active-changed',
            Lang.bind(this, this._setToolbarTitle));
        this._searchSourceId = Application.sourceManager.connect('active-changed',
            Lang.bind(this, this._setToolbarTitle));
        this._selectionModeId = Application.selectionController.connect('selection-mode-changed',
            Lang.bind(this, this._resetToolbarMode));
        this._resetToolbarMode();

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                this._clearStateData();

                if (this._selectionModeId != 0) {
                    Application.selectionController.disconnect(this._selectionModeId);
                    this._selectionModeId = 0;
                }

                if (this._searchStringId != 0) {
                    Application.searchController.disconnect(this._searchStringId);
                    this._searchStringId = 0;
                }

                if (this._searchTypeId != 0) {
                    Application.searchTypeManager.disconnect(this._searchTypeId);
                    this._searchTypeId = 0;
                }

                if (this._searchMatchId != 0) {
                    Application.searchMatchManager.disconnect(this._searchMatchId);
                    this._searchMatchId = 0;
                }

                if (this._searchSourceId != 0) {
                    Application.sourceManager.disconnect(this._searchSourceId);
                    this._searchSourceId = 0;
                }
            }));
    },

    _setToolbarTitle: function() {
        let selectionMode = Application.selectionController.getSelectionMode();
        let activeCollection = Application.collectionManager.getActiveItem();
        let primary = null;
        let detail = null;

        if (!selectionMode) {
            if (activeCollection) {
                primary = activeCollection.name;
            } else {
                let string = Application.searchController.getString();

                if (string == '') {
                    let searchType = Application.searchTypeManager.getActiveItem();
                    let searchSource = Application.sourceManager.getActiveItem();

                    if (searchType.id != 'all')
                        primary = searchType.name;

                    if (searchSource.id != 'all')
                        detail = searchSource.name;
                } else {
                    let searchMatch = Application.searchMatchManager.getActiveItem();

                    primary = _("Results for “%s”").format(string);
                    if (searchMatch.id == 'title')
                        detail = _("filtered by title");
                    else if (searchMatch.id == 'author')
                        detail = _("filtered by author");
                }
            }
        } else {
            let length = Application.selectionController.getSelection().length;

            if (length == 0)
                detail = _("Click on items to select them");
            else
                detail = Gettext.ngettext("%d selected",
                                          "%d selected",
                                          length).format(length);

            if (activeCollection) {
                primary = activeCollection.name;
            } else if (length != 0) {
                primary = detail;
                detail = null;
            }
        }

        if (detail)
            detail = '(' + detail + ')';

        this.toolbar.set_labels(primary, detail);
    },

    _populateForSelectionMode: function() {
        this.toolbar.get_style_context().add_class('selection-mode');
        this.toolbar.reset_style();

        this.addSearchButton();

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/selection-menu.ui');
        let selectionMenu = builder.get_object('selection-menu');
        this.toolbar.set_labels_menu(selectionMenu);

        let selectionButton =
            this.toolbar.add_button(null, _("Done"), false);
        selectionButton.get_style_context().add_class('suggested-action');
        selectionButton.connect('clicked', Lang.bind(this,
            function() {
                Application.selectionController.setSelectionMode(false);
            }));

        // connect to selection changes while in this mode
        this._selectionChangedId =
            Application.selectionController.connect('selection-changed',
                                               Lang.bind(this, this._setToolbarTitle));
    },

    _checkCollectionBackButton: function() {
        let item = Application.collectionManager.getActiveItem();

        if (item && !this._collBackButton) {
            this._collBackButton =
                this.toolbar.add_button('go-previous-symbolic', _("Back"), true);
            this._collBackButton.connect('clicked', Lang.bind(this,
                function() {
                    Application.documentManager.activatePreviousCollection();
                }));
        } else if (!item && this._collBackButton) {
            this._collBackButton.destroy();
            this._collBackButton = null;
        }
    },

    _onActiveCollectionChanged: function() {
        this._checkCollectionBackButton();
        this._setToolbarTitle();
        Application.application.change_action_state('search', GLib.Variant.new('b', false));
    },

    _populateForOverview: function() {
        this._checkCollectionBackButton();
        this.addSearchButton();

        let selectionButton =
            this.toolbar.add_button('object-select-symbolic', _("Select Items"), false);
        selectionButton.connect('clicked', Lang.bind(this,
            function() {
                Application.selectionController.setSelectionMode(true);
            }));

        // connect to active collection changes while in this mode
        this._collectionId =
            Application.collectionManager.connect('active-changed',
                                             Lang.bind(this, this._onActiveCollectionChanged));
    },

    _clearStateData: function() {
        this._collBackButton = null;
        this.toolbar.set_labels_menu(null);

        if (this._collectionId != 0) {
            Application.collectionManager.disconnect(this._collectionId);
            this._collectionId = 0;
        }

        if (this._selectionChangedId != 0) {
            Application.selectionController.disconnect(this._selectionChangedId);
            this._selectionChangedId = 0;
        }
    },

    _clearToolbar: function() {
        this._clearStateData();

        this.toolbar.get_style_context().remove_class('selection-mode');
        this.toolbar.reset_style();
        this.toolbar.clear();
    },

    _resetToolbarMode: function() {
        this._clearToolbar();

        let selectionMode = Application.selectionController.getSelectionMode();
        if (selectionMode)
            this._populateForSelectionMode();
        else
            this._populateForOverview();

        this._setToolbarTitle();
        this.toolbar.show_all();

        if (Application.searchController.getString() != '')
            Application.application.change_action_state('search', GLib.Variant.new('b', true));
    },

    createSearchbar: function() {
        // create the dropdown for the search bar, it's hidden by default
        let dropdown = new Searchbar.Dropdown();
        this._overlay.add_overlay(dropdown.widget);

        return new Searchbar.OverviewSearchbar(dropdown);
    }
});
