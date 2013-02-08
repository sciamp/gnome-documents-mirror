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
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Tracker = imports.gi.Tracker;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;
const Manager = imports.manager;
const Tweener = imports.tweener.tweener;
const Utils = imports.utils;

const _SEARCH_ENTRY_TIMEOUT = 200;

const Searchbar = new Lang.Class({
    Name: 'Searchbar',

    _init: function() {
        this._searchEntryTimeout = 0;
        this._searchTypeId = 0;
        this._searchMatchId = 0;

        this._in = false;

        this.widget = new Gd.Revealer();

        let toolbar = new Gtk.Toolbar();
        toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_PRIMARY_TOOLBAR);
        this.widget.add(toolbar);

        // subclasses will create this._searchEntry and this._searchContainer
        // GtkWidgets
        this.createSearchWidgets();

        let item = new Gtk.ToolItem();
        item.set_expand(true);
        item.add(this._searchContainer);
        toolbar.insert(item, 0);

        this._searchEntry.connect('key-press-event', Lang.bind(this,
            function(widget, event) {
                let keyval = event.get_keyval()[1];

                if (keyval == Gdk.KEY_Escape) {
                    Application.application.change_action_state('search', GLib.Variant.new('b', false));
                    return true;
                }

                return false;
            }));

        this._searchEntry.connect('changed', Lang.bind(this,
            function() {
                if (this._searchEntryTimeout != 0) {
                    Mainloop.source_remove(this._searchEntryTimeout);
                    this._searchEntryTimeout = 0;
                }

                if (this._searchChangeBlocked)
                    return;

                this._searchEntryTimeout = Mainloop.timeout_add(_SEARCH_ENTRY_TIMEOUT, Lang.bind(this,
                    function() {
                        this._searchEntryTimeout = 0;
                        this.entryChanged();
                    }));
            }));

        // connect to the search action state for visibility
        let searchStateId = Application.application.connect('action-state-changed::search',
            Lang.bind(this, this._onActionStateChanged));
        this._onActionStateChanged(Application.application, 'search', Application.application.get_action_state('search'));

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                Application.application.disconnect(searchStateId);
                Application.application.change_action_state('search', GLib.Variant.new('b', false));
            }));

        this.widget.show_all();
    },

    _onActionStateChanged: function(source, actionName, state) {
        if (state.get_boolean())
            this.show();
        else
            this.hide();
    },

    createSearchWidgets: function() {
        log('Error: Searchbar implementations must override createSearchWidgets');
    },

    entryChanged: function() {
        log('Error: Searchbar implementations must override entryChanged');
    },

    destroy: function() {
        this.widget.destroy();
    },

    _isKeynavEvent: function(event) {
        let keyval = event.get_keyval()[1];
        let state = event.get_state()[1];

        if (keyval == Gdk.KEY_Tab ||
            keyval == Gdk.KEY_KP_Tab ||
            keyval == Gdk.KEY_Up ||
            keyval == Gdk.KEY_KP_Up ||
            keyval == Gdk.KEY_Up ||
            keyval == Gdk.KEY_Down ||
            keyval == Gdk.KEY_KP_Down ||
            keyval == Gdk.KEY_Left ||
            keyval == Gdk.KEY_KP_Left ||
            keyval == Gdk.KEY_Right ||
            keyval == Gdk.KEY_KP_Right ||
            keyval == Gdk.KEY_Home ||
            keyval == Gdk.KEY_KP_Home ||
            keyval == Gdk.KEY_End ||
            keyval == Gdk.KEY_KP_End ||
            keyval == Gdk.KEY_Page_Up ||
            keyval == Gdk.KEY_KP_Page_Up ||
            keyval == Gdk.KEY_Page_Down ||
            keyval == Gdk.KEY_KP_Page_Down ||
            (state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.MOD1_MASK) != 0))
            return true;

        return false;
    },

    _isSpaceEvent: function(event) {
        let keyval = event.get_keyval()[1];
        return (keyval == Gdk.KEY_space);
    },

    handleEvent: function(event) {
        if (this._in)
            return false;

        if (this._isKeynavEvent(event))
            return false;

        if (this._isSpaceEvent(event))
            return false;

        if (!this._searchEntry.get_realized())
            this._searchEntry.realize();

        let handled = false;

        let preeditChanged = false;
        let preeditChangedId =
            this._searchEntry.connect('preedit-changed', Lang.bind(this,
                function() {
                    preeditChanged = true;
                }));

        let oldText = this._searchEntry.get_text();
        let res = this._searchEntry.event(event);
        let newText = this._searchEntry.get_text();

        this._searchEntry.disconnect(preeditChangedId);

        if (((res && (newText != oldText)) || preeditChanged)) {
            handled = true;

            if (!this._in)
                Application.application.change_action_state('search', GLib.Variant.new('b', true));
        }

        return handled;
    },

    show: function() {
        let eventDevice = Gtk.get_current_event_device();
        this.widget.set_revealed(true);
        this._in = true;

        if (eventDevice)
            Gd.entry_focus_hack(this._searchEntry, eventDevice);
    },

    hide: function() {
        this._in = false;
        this.widget.set_revealed(false);
        // clear all the search properties when hiding the entry
        this._searchChangeBlocked = true;
        this._searchEntry.set_text('');
        this._searchChangeBlocked = false;
    }
});

const Dropdown = new Lang.Class({
    Name: 'Dropdown',

    _init: function() {
        this._sourceView = new Manager.BaseView(Application.sourceManager);
        this._typeView = new Manager.BaseView(Application.searchTypeManager);
        this._matchView = new Manager.BaseView(Application.searchMatchManager);
        // TODO: this is out for now, but should we move it somewhere
        // else?
        // this._categoryView = new Manager.BaseView(Application.searchCategoryManager);

        this._sourceView.connect('item-activated',
                                 Lang.bind(this, this._onItemActivated));
        this._typeView.connect('item-activated',
                               Lang.bind(this, this._onItemActivated));
        this._matchView.connect('item-activated',
                                Lang.bind(this, this._onItemActivated));

        this.widget = new Gtk.Frame({ shadow_type: Gtk.ShadowType.IN,
                                      halign: Gtk.Align.CENTER,
                                      valign: Gtk.Align.START,
                                      opacity: 0 });
        this.widget.get_style_context().add_class('documents-dropdown');

        this._grid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL });
        this.widget.add(this._grid);

        this._grid.add(this._sourceView.widget);
        this._grid.add(this._typeView.widget);
        this._grid.add(this._matchView.widget);
        //this._grid.add(this._categoryView.widget);

        this.hide();
    },

    _onItemActivated: function() {
        this.emit('item-activated');
    },

    show: function() {
        this.widget.show_all();

        Tweener.addTween(this.widget, { opacity: 0.9,
                                        time: 0.20,
                                        transition: 'easeOutQuad' });
    },

    hide: function() {
        Tweener.addTween(this.widget, { opacity: 0,
                                        time: 0.20,
                                        transition: 'easeOutQuad',
                                        onComplete: function() {
                                            this.widget.hide();
                                        },
                                        onCompleteScope: this });
    }
});
Signals.addSignalMethods(Dropdown.prototype);

const OverviewSearchbar = new Lang.Class({
    Name: 'OverviewSearchbar',
    Extends: Searchbar,

    _init: function(dropdown) {
        this._dropdown = dropdown;

        this.parent();

        this._sourcesId = Application.sourceManager.connect('active-changed',
            Lang.bind(this, this._onActiveSourceChanged));
        this._searchTypeId = Application.searchTypeManager.connect('active-changed',
            Lang.bind(this, this._onActiveTypeChanged));
        this._searchMatchId = Application.searchMatchManager.connect('active-changed',
            Lang.bind(this, this._onActiveMatchChanged));
        this._collectionId = Application.collectionManager.connect('active-changed',
            Lang.bind(this, this._onActiveCollectionChanged));

        this._onActiveSourceChanged();
        this._onActiveTypeChanged();
        this._onActiveMatchChanged();
    },

    createSearchWidgets: function() {
        // create the search entry
        this._searchEntry = new Gd.TaggedEntry({ width_request: 500 });
        this._searchEntry.connect('tag-clicked',
            Lang.bind(this, this._onTagClicked));

        // connect to search string changes in the controller
        this._searchEntry.text = Application.searchController.getString();
        let searchChangedId = Application.searchController.connect('search-string-changed', Lang.bind(this,
            function(controller, string) {
                this._searchEntry.text = string;
            }));

        this._searchEntry.connect('destroy', Lang.bind(this,
            function() {
                Application.searchController.disconnect(searchChangedId);
            }));

        // create the dropdown button
        this._dropdownButton = new Gtk.ToggleButton(
            { child: new Gtk.Arrow({ arrow_type: Gtk.ArrowType.DOWN }) });
        this._dropdownButton.connect('toggled', Lang.bind(this,
            function() {
                let active = this._dropdownButton.get_active();
                if (active)
                    this._dropdown.show();
                else
                    this._dropdown.hide();
            }));
        this._dropdown.connect('item-activated', Lang.bind(this,
            function() {
                this._dropdownButton.set_active(false);
            }));

        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              halign: Gtk.Align.CENTER });

        this._searchContainer.add(this._searchEntry);
        this._searchContainer.add(this._dropdownButton);
        this._searchContainer.show_all();
    },

    entryChanged: function() {
        let currentText = this._searchEntry.get_text().toLowerCase();
        Application.searchController.setString(currentText);
    },

    _onActiveCollectionChanged: function() {
        let searchType = Application.searchTypeManager.getActiveItem();

        if (Application.searchController.getString() != '' ||
            searchType.id != 'all') {
            Application.searchTypeManager.setActiveItemById('all');
            this._searchEntry.set_text('');
        }
    },

    _onActiveChangedCommon: function(id, manager) {
        let item = manager.getActiveItem();

        if (item.id == 'all') {
            this._searchEntry.remove_tag(id);
        } else {
            let res = this._searchEntry.add_tag(id, item.name);

            if (res) {
                this._searchEntry.connect('tag-button-clicked::' + id, Lang.bind(this,
                    function() {
                        manager.setActiveItemById('all');
                    }));
            } else {
                this._searchEntry.set_tag_label(id, item.name);
            }
        }
    },

    _onActiveSourceChanged: function() {
        this._onActiveChangedCommon('source', Application.sourceManager);
    },

    _onActiveTypeChanged: function() {
        this._onActiveChangedCommon('type', Application.searchTypeManager);
    },

    _onActiveMatchChanged: function() {
        this._onActiveChangedCommon('match', Application.searchMatchManager);
    },

    _onTagClicked: function() {
        this._dropdownButton.set_active(true);
    },

    destroy: function() {
        if (this._sourcesId != 0) {
            Application.sourceManager.disconnect(this._sourcesId);
            this._sourcesId = 0;
        }

        if (this._searchTypeId != 0) {
            Application.searchTypeManager.disconnect(this._searchTypeId);
            this._searchTypeId = 0;
        }

        if (this._searchMatchId != 0) {
            Application.searchMatchManager.disconnect(this._searchMatchId);
            this._searchMatchId = 0;
        }

        if (this._collectionId != 0) {
            Application.collectionManager.disconnect(this._collectionId);
            this._collectionId = 0;
        }

        this.parent();
    },

    hide: function() {
        this._dropdownButton.set_active(false);

        Application.searchTypeManager.setActiveItemById('all');
        Application.searchMatchManager.setActiveItemById('all');
        Application.sourceManager.setActiveItemById('all');

        this.parent();
    }
});
