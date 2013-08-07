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

const EvView = imports.gi.EvinceView;
const Gd = imports.gi.Gd;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;
const _ = imports.gettext.gettext;
const C_ = imports.gettext.pgettext;

const Application = imports.application;
const Documents = imports.documents;
const Manager = imports.manager;
const Notifications = imports.notifications;
const Properties = imports.properties;
const Query = imports.query;
const Sharing = imports.sharing;
const Utils = imports.utils;

const Lang = imports.lang;
const Signals = imports.signals;

const _COLLECTION_PLACEHOLDER_ID = 'collection-placeholder';
const _SEPARATOR_PLACEHOLDER_ID = 'separator-placeholder';

// fetch all the collections a given item is part of
const FetchCollectionsJob = new Lang.Class({
    Name: 'FetchCollectionsJob',

    _init: function(urn) {
        this._urn = urn;
        this._collections = [];
    },

    run: function(callback) {
        this._callback = callback;

        let query = Application.queryBuilder.buildFetchCollectionsQuery(this._urn);
        Application.connectionQueue.add(query.sparql, null, Lang.bind(this,
            function(object, res) {
                let cursor = null;

                try {
                    cursor = object.query_finish(res);
                    cursor.next_async(null, Lang.bind(this, this._onCursorNext));
                } catch (e) {
                    log(e);
                    this._emitCallback();
                }
            }));
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            log(e);
        }

        if (!valid) {
            cursor.close();
            this._emitCallback();

            return;
        }

        let urn = cursor.get_string(0)[0];
        this._collections.push(urn);

        cursor.next_async(null, Lang.bind(this, this._onCursorNext));
    },

    _emitCallback: function() {
        if (this._callback)
            this._callback(this._collections);
    }
});

// fetch the state of every collection applicable to the selected items
const OrganizeCollectionState = {
    NORMAL: 0,
    ACTIVE: 1 << 0,
    INCONSISTENT: 1 << 1,
    HIDDEN: 1 << 2
};

const FetchCollectionStateForSelectionJob = new Lang.Class({
    Name: 'FetchCollectionStateForSelectionJob',

    _init: function() {
        this._collectionsForItems = {};
        this._runningJobs = 0;
    },

    run: function(callback) {
        this._callback = callback;

        let urns = Application.selectionController.getSelection();
        urns.forEach(Lang.bind(this,
            function(urn) {
                let job = new FetchCollectionsJob(urn);

                this._runningJobs++;
                job.run(Lang.bind(this, this._jobCollector, urn));
            }));
    },

    _jobCollector: function(collectionsForItem, urn) {
        this._collectionsForItems[urn] = collectionsForItem;

        this._runningJobs--;
        if (!this._runningJobs)
            this._emitCallback();
    },

    _emitCallback: function() {
        let collectionState = {};
        let collections = Application.collectionManager.getItems();

        // for all the registered collections...
        for (let collIdx in collections) {
            let collection = collections[collIdx];

            let found = false;
            let notFound = false;
            let hidden = false;

            // if the only object we are fetching collection state for is a
            // collection itself, hide this if it's the same collection.
            if (Object.keys(this._collectionsForItems).length == 1) {
                let itemIdx = Object.keys(this._collectionsForItems)[0];
                let item = Application.documentManager.getItemById(itemIdx);

                if (item.id == collection.id)
                    hidden = true;
            }

            for (let itemIdx in this._collectionsForItems) {
                let item = Application.documentManager.getItemById(itemIdx);
                let collectionsForItem = this._collectionsForItems[itemIdx];

                // if one of the selected items is part of this collection...
                if (collectionsForItem.indexOf(collIdx) != -1)
                    found = true;
                else
                    notFound = true;

                if ((item.resourceUrn != collection.resourceUrn) &&
                    (collection.identifier.indexOf(Query.LOCAL_COLLECTIONS_IDENTIFIER) == -1)) {
                    hidden = true;
                }
            }

            let state = OrganizeCollectionState.NORMAL;

            if (found && notFound)
                // if some items are part of this collection and some are not...
                state |= OrganizeCollectionState.INCONSISTENT;
            else if (found)
                // if all items are part of this collection...
                state |= OrganizeCollectionState.ACTIVE;

            if (hidden)
                state |= OrganizeCollectionState.HIDDEN;

            collectionState[collIdx] = state;
        }

        if (this._callback)
            this._callback(collectionState);
    }
});

// updates the mtime for the given resource to the current system time
const UpdateMtimeJob = new Lang.Class({
    Name: 'UpdateMtimeJob',

    _init: function(urn) {
        this._urn = urn;
    },

    run: function(callback) {
        this._callback = callback;

        let query = Application.queryBuilder.buildUpdateMtimeQuery(this._urn);
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

// adds or removes the selected items to the given collection
const SetCollectionForSelectionJob = new Lang.Class({
    Name: 'SetCollectionForSelectionJob',

    _init: function(collectionUrn, setting) {
        this._collectionUrn = collectionUrn;
        this._setting = setting;
        this._runningJobs = 0;
    },

    run: function(callback) {
        this._callback = callback;

        let urns = Application.selectionController.getSelection();
        urns.forEach(Lang.bind(this,
            function(urn) {
                // never add a collection to itself!!
                if (urn == this._collectionUrn)
                    return;

                let query = Application.queryBuilder.buildSetCollectionQuery(urn,
                    this._collectionUrn, this._setting);
                this._runningJobs++;

                Application.connectionQueue.update(query.sparql, null, Lang.bind(this,
                    function(object, res) {
                        try {
                            object.update_finish(res);
                        } catch (e) {
                            log(e);
                        }

                        this._jobCollector();
                    }));
            }));
    },

    _jobCollector: function() {
        this._runningJobs--;

        if (this._runningJobs == 0) {
            let job = new UpdateMtimeJob(this._collectionUrn);
            job.run(Lang.bind(this,
                function() {

                    if (this._callback)
                        this._callback();
                }));
        }
    }
});

// creates an (empty) collection with the given name
const CreateCollectionJob = new Lang.Class({
    Name: 'CreateCollectionJob',

    _init: function(name) {
        this._name = name;
        this._createdUrn = null;
    },

    run: function(callback) {
        this._callback = callback;

        let query = Application.queryBuilder.buildCreateCollectionQuery(this._name);
        Application.connectionQueue.updateBlank(query.sparql, null, Lang.bind(this,
            function(object, res) {
                let variant = null;
                try {
                    variant = object.update_blank_finish(res); // variant is aaa{ss}
                } catch (e) {
                    log(e);
                }

                variant = variant.get_child_value(0); // variant is now aa{ss}
                variant = variant.get_child_value(0); // variant is now a{ss}
                variant = variant.get_child_value(0); // variant is now {ss}

                let key = variant.get_child_value(0).get_string()[0];
                let val = variant.get_child_value(1).get_string()[0];

                if (key == 'res')
                    this._createdUrn = val;

                if (this._callback)
                    this._callback(this._createdUrn);
            }));
    }
});

const OrganizeModelColumns = {
    ID: 0,
    NAME: 1,
    STATE: 2
};

const OrganizeCollectionModel = new Lang.Class({
    Name: 'OrganizeCollectionModel',

    _init: function() {
        this.model = Gtk.ListStore.new(
            [ GObject.TYPE_STRING,
              GObject.TYPE_STRING,
              GObject.TYPE_INT ]);

        this._collAddedId = Application.collectionManager.connect('item-added',
            Lang.bind(this, this._onCollectionAdded));
        this._collRemovedId = Application.collectionManager.connect('item-removed',
            Lang.bind(this, this._onCollectionRemoved));

        let iter;

        // add the placeholder
        iter = this.model.append();
        this.model.set(iter,
            [ 0, 1, 2 ],
            [ _COLLECTION_PLACEHOLDER_ID, '', OrganizeCollectionState.ACTIVE ]);

        // add the separator
        iter = this.model.append();
        this.model.set(iter,
            [ 0, 1, 2 ],
            [ _SEPARATOR_PLACEHOLDER_ID, '', OrganizeCollectionState.ACTIVE ]);

        // populate the model
        let job = new FetchCollectionStateForSelectionJob();
        job.run(Lang.bind(this, this._onFetchCollectionStateForSelection));
    },

    _findCollectionIter: function(item) {
        let collPath = null;

        this.model.foreach(Lang.bind(this,
            function(model, path, iter) {
                let id = model.get_value(iter, OrganizeModelColumns.ID);

                if (item.id == id) {
                    collPath = path.copy();
                    return true;
                }

                return false;
            }));

        if (collPath)
            return this.model.get_iter(collPath)[1];

        return null;
    },

    _onFetchCollectionStateForSelection: function(collectionState) {
        for (let idx in collectionState) {
            let item = Application.collectionManager.getItemById(idx);

            if ((collectionState[item.id] & OrganizeCollectionState.HIDDEN) != 0)
                continue;

            let iter = this._findCollectionIter(item);

            if (!iter)
                iter = this.model.append();

            this.model.set(iter,
                [ 0, 1, 2 ],
                [ item.id, item.name, collectionState[item.id] ]);
        }
    },

    _refreshState: function() {
        let job = new FetchCollectionStateForSelectionJob();
        job.run(Lang.bind(this, this._onFetchCollectionStateForSelection));
    },

    _onCollectionAdded: function(manager, itemAdded) {
        this._refreshState();
    },

    _onCollectionRemoved: function(manager, itemRemoved) {
        let iter = this._findCollectionIter(itemRemoved);

        if (iter)
            this.model.remove(iter);
    },

    refreshCollectionState: function() {
        this._refreshState();
    },

    destroy: function() {
        if (this._collAddedId != 0) {
            Application.collectionManager.disconnect(this._collAddedId);
            this._collAddedId = 0;
        }

        if (this._collRemovedId != 0) {
            Application.collectionManager.disconnect(this._collRemovedId);
            this._collRemovedId = 0;
        }
    }
});

const OrganizeCollectionView = new Lang.Class({
    Name: 'OrganizeCollectionView',

    _init: function() {
        this._choiceConfirmed = false;

        this.widget = new Gtk.Overlay();

        this._sw = new Gtk.ScrolledWindow({ shadow_type: Gtk.ShadowType.IN,
                                            margin_left: 5,
                                            margin_right: 5,
                                            margin_bottom: 3 });
        this.widget.add(this._sw);

        this._model = new OrganizeCollectionModel();
        this._view = new Gtk.TreeView({ headers_visible: false,
                                        vexpand: true,
                                        hexpand: true });
        this._view.set_model(this._model.model);
        this._view.set_row_separator_func(Lang.bind(this,
            function(model, iter) {
                let id = model.get_value(iter, OrganizeModelColumns.ID);
                return (id == _SEPARATOR_PLACEHOLDER_ID);
            }));
        this._sw.add(this._view);

        this._msgGrid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                       row_spacing: 12,
                                       halign: Gtk.Align.CENTER,
                                       margin_top: 64 });
        this.widget.add_overlay(this._msgGrid);

        this._icon = new Gtk.Image({ resource: '/org/gnome/documents/collections-placeholder.png' });
        this._msgGrid.add(this._icon);

        this._label = new Gtk.Label({
            justify: Gtk.Justification.CENTER,
            label: _("You don't have any collections yet. Enter a new collection name above."),
            max_width_chars: 32,
            wrap: true });
        this._label.get_style_context().add_class('dim-label');
        this._msgGrid.add(this._label);

        // show the overlay only if there aren't any collections in the model
        this._msgGrid.visible = (this._model.model.iter_n_children(null) < 2);
        this._model.model.connect('row-inserted', Lang.bind(this,
            function() {
                this._msgGrid.hide();
            }));

        // force the editable row to be unselected
        this.selection = this._view.get_selection();
        let selectionChangedId = this.selection.connect('changed', Lang.bind(this,
            function() {
                this.selection.unselect_all();
                if (selectionChangedId != 0) {
                    this.selection.disconnect(selectionChangedId);
                    selectionChangedId = 0;
                }
            }));

        this._view.connect('destroy', Lang.bind(this,
            function() {
                this._model.destroy();
            }));

        this._viewCol = new Gtk.TreeViewColumn();
        this._view.append_column(this._viewCol);

        // checkbox
        this._rendererCheck = new Gtk.CellRendererToggle();
        this._viewCol.pack_start(this._rendererCheck, false);
        this._viewCol.set_cell_data_func(this._rendererCheck,
                                         Lang.bind(this, this._checkCellFunc));
        this._rendererCheck.connect('toggled', Lang.bind(this, this._onCheckToggled));

        // icon
        this._rendererIcon = new Gtk.CellRendererPixbuf();
        this._viewCol.pack_start(this._rendererIcon, false);
        this._viewCol.set_cell_data_func(this._rendererIcon,
                                         Lang.bind(this, this._iconCellFunc));

        // item name
        this._rendererText = new Gtk.CellRendererText();
        this._viewCol.pack_start(this._rendererText, true);
        this._viewCol.set_cell_data_func(this._rendererText,
                                         Lang.bind(this, this._textCellFunc));

        this._rendererDetail = new Gd.StyledTextRenderer({ xpad: 16 });
        this._rendererDetail.add_class('dim-label');
        this._viewCol.pack_start(this._rendererDetail, false);
        this._viewCol.set_cell_data_func(this._rendererDetail,
                                         Lang.bind(this, this._detailCellFunc));

        this._rendererText.connect('edited', Lang.bind(this, this._onTextEdited));
        this._rendererText.connect('editing-canceled', Lang.bind(this, this._onTextEditCanceled));

        this._view.show();
    },

    _onCheckToggled: function(renderer, pathStr) {
        let path = Gtk.TreePath.new_from_string(pathStr);
        let iter = this._model.model.get_iter(path)[1];

        let collUrn = this._model.model.get_value(iter, OrganizeModelColumns.ID);
        let state = this._rendererCheck.get_active();

        let job = new SetCollectionForSelectionJob(collUrn, !state);
        job.run(Lang.bind(this,
            function() {
                this._model.refreshCollectionState();
            }));
    },

    _onTextEditedReal: function(cell, newText) {
        //cell.editable = false;

        if (!newText || newText == '') {
            // don't insert collections with empty names
            return;
        }

        // update the new name immediately
        let iter = this._model.model.append();
        this._model.model.set_value(iter, OrganizeModelColumns.NAME, newText);

        // force the editable row to be unselected
        this.selection.unselect_all();

        // actually create the new collection
        let job = new CreateCollectionJob(newText);
        job.run(Lang.bind(this,
            function(createdUrn) {
                if (!createdUrn)
                    return;

                this._model.model.set_value(iter, OrganizeModelColumns.ID, createdUrn);

                let job = new SetCollectionForSelectionJob(createdUrn, true);
                job.run(null);
            }));
    },

    _onTextEdited: function(cell, pathStr, newText) {
        this._onTextEditedReal(cell, newText);
    },

    _onTextEditCanceled: function(cell) {
        if (this._choiceConfirmed) {
            this._choiceConfirmed = false;

            let entry = this._viewCol.cell_area.get_edit_widget();
            if (entry)
                this._onTextEditedReal(cell, entry.get_text());
        }
    },

    _checkCellFunc: function(col, cell, model, iter) {
        let state = model.get_value(iter, OrganizeModelColumns.STATE);
        let id = model.get_value(iter, OrganizeModelColumns.ID);

        cell.active = (state & OrganizeCollectionState.ACTIVE);
        cell.inconsistent = (state & OrganizeCollectionState.INCONSISTENT);
        cell.visible = (id != _COLLECTION_PLACEHOLDER_ID);
    },

    _iconCellFunc: function(col, cell, model, iter) {
        let id = model.get_value(iter, OrganizeModelColumns.ID);

        cell.icon_name = "gtk-add";
        cell.visible = (id == _COLLECTION_PLACEHOLDER_ID);
    },

    _textCellFunc: function(col, cell, model, iter) {
        let id = model.get_value(iter, OrganizeModelColumns.ID);
        let name = model.get_value(iter, OrganizeModelColumns.NAME);

        if (id == _COLLECTION_PLACEHOLDER_ID) {
            cell.editable = true;
            cell.text = '';
            cell.placeholder_text = _("Create new collection");
        } else {
            cell.editable = false;
            cell.text = name;
        }
    },

    _detailCellFunc: function(col, cell, model, iter) {
        let id = model.get_value(iter, OrganizeModelColumns.ID);
        let item = Application.collectionManager.getItemById(id);

        if (item && item.identifier.indexOf(Query.LOCAL_COLLECTIONS_IDENTIFIER) == -1) {
            cell.text = Application.sourceManager.getItemById(item.resourceUrn).name;
            cell.visible = true;
        } else {
            cell.text = '';
            cell.visible = false;
        }
    },

    confirmedChoice: function() {
        this._choiceConfirmed = true;
    }
});

const OrganizeCollectionDialog = new Lang.Class({
    Name: 'OrganizeCollectionDialog',

    _init: function(toplevel) {
        this.widget = new Gtk.Dialog({ transient_for: toplevel,
                                       modal: true,
                                       destroy_with_parent: true,
                                       default_width: 400,
                                       default_height: 250,
        // Translators: "Collections" refers to documents in this context
                                       title: C_("Dialog Title", "Collections") });

        let closeButton = this.widget.add_button('gtk-close', Gtk.ResponseType.CLOSE);
        this.widget.set_default_response(Gtk.ResponseType.CLOSE);

        let contentArea = this.widget.get_content_area();
        let collView = new OrganizeCollectionView();
        contentArea.add(collView.widget);

        // HACK:
        // - We want clicking on "Close" to add the typed-in collection if we're
        //   editing.
        // - Unfortunately, since we focus out of the editable entry in order to
        //   click the button, we'll get an editing-canceled signal on the renderer
        //   from GTK. As this handler will run before focus-out, we here signal the
        //   view to ignore the next editing-canceled signal and add the collection in
        //   that case instead.
        //
        closeButton.connect('button-press-event', Lang.bind(this,
            function() {
                collView.confirmedChoice();
                return false;
            }));

        this.widget.show_all();
    }
});

const SelectionController = new Lang.Class({
    Name: 'SelectionController',

    _init: function() {
        this._selection = [];
        this._selectionMode = false;

        Application.documentManager.connect('item-removed',
            Lang.bind(this, this._onDocumentRemoved));
    },

    _onDocumentRemoved: function(manager, item) {
        let changed = false;
        let filtered = this._selection.filter(Lang.bind(this,
            function(value, index) {
                if (item.id == value)
                    changed = true;

                return (item.id != value);
            }));

        if (changed) {
            this._selection = filtered;
            this.emit('selection-changed', this._selection);
        }
    },

    setSelection: function(selection) {
        if (this._isFrozen)
            return;

        if (!selection)
            this._selection = [];
        else
            this._selection = selection;

        this.emit('selection-changed', this._selection);
    },

    getSelection: function() {
        return this._selection;
    },

    freezeSelection: function(freeze) {
        if (freeze == this._isFrozen)
            return;

        this._isFrozen = freeze;
    },

    setSelectionMode: function(setting) {
        if (this._selectionMode == setting)
            return;

        this._selectionMode = setting;
        this.emit('selection-mode-changed', this._selectionMode);
    },

    getSelectionMode: function() {
        return this._selectionMode;
    }
});
Signals.addSignalMethods(SelectionController.prototype);

const _SELECTION_TOOLBAR_DEFAULT_WIDTH = 500;

const SelectionToolbar = new Lang.Class({
    Name: 'SelectionToolbar',

    _init: function() {
        this._itemListeners = {};
        this._insideRefresh = false;

        this.widget = new Gtk.Revealer({ transition_type: Gtk.RevealerTransitionType.SLIDE_UP });

        let toolbar = new Gtk.HeaderBar();
        this.widget.add(toolbar);

        // open button
        this._toolbarOpen = new Gd.HeaderSimpleButton({ label: _("Open") });
        toolbar.pack_start(this._toolbarOpen);
        this._toolbarOpen.connect('clicked', Lang.bind(this, this._onToolbarOpen));

        // print button
        this._toolbarPrint = new Gd.HeaderSimpleButton({ label: _("Print") });
        toolbar.pack_start(this._toolbarPrint);
        this._toolbarPrint.connect('clicked', Lang.bind(this, this._onToolbarPrint));

        // trash button
        this._toolbarTrash = new Gd.HeaderSimpleButton({ label: _("Delete") });
        toolbar.pack_start(this._toolbarTrash);
        this._toolbarTrash.connect('clicked', Lang.bind(this, this._onToolbarTrash));

        // organize button
        this._toolbarCollection = new Gd.HeaderSimpleButton({ label: _("Add to Collection") });
        toolbar.pack_end(this._toolbarCollection);
        this._toolbarCollection.connect('clicked', Lang.bind(this, this._onToolbarCollection));

        // properties button
        this._toolbarProperties = new Gd.HeaderSimpleButton({ label: _("Properties") });
        toolbar.pack_end(this._toolbarProperties);
        this._toolbarProperties.connect('clicked', Lang.bind(this, this._onToolbarProperties));

        // share button
	this._toolbarShare = new Gd.HeaderSimpleButton({ label: _("Share") });
        toolbar.pack_end(this._toolbarShare);
        this._toolbarShare.connect('clicked', Lang.bind(this, this._onToolbarShare));

        this.widget.show_all();

        Application.selectionController.connect('selection-mode-changed',
            Lang.bind(this, this._onSelectionModeChanged));
        Application.selectionController.connect('selection-changed',
            Lang.bind(this, this._onSelectionChanged));
    },

    _onSelectionModeChanged: function(controller, mode) {
        if (mode)
            this._onSelectionChanged();
        else
            this.widget.set_reveal_child(false);
    },

    _onSelectionChanged: function() {
        if (!Application.selectionController.getSelectionMode())
            return;

        let selection = Application.selectionController.getSelection();
        this._setItemListeners(selection);

        this._setItemVisibility();
        this.widget.set_reveal_child(true);
    },

    _setItemListeners: function(selection) {
        for (let idx in this._itemListeners) {
            let doc = this._itemListeners[idx];
            doc.disconnect(idx);
            delete this._itemListeners[idx];
        }

        selection.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);
                let id = doc.connect('info-updated', Lang.bind(this, this._setItemVisibility));
                this._itemListeners[id] = doc;
            }));
    },

    _setItemVisibility: function() {
        let apps = [];
        let selection = Application.selectionController.getSelection();
        let hasSelection = (selection.length > 0);

        let showTrash = hasSelection;
        let showPrint = hasSelection;
        let showProperties = hasSelection;
        let showOpen = hasSelection;
        let showShare = hasSelection;
        let showCollection = hasSelection;

        this._insideRefresh = true;

        selection.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);

                if ((doc.defaultAppName) &&
                    (apps.indexOf(doc.defaultAppName) == -1))
                    apps.push(doc.defaultAppName);
                if ((doc instanceof Documents.LocalDocument) ||
                    (doc.collection != false) ||
                    (selection.length > 1))
                    showShare = false;

                showTrash &= doc.canTrash();
                showPrint &= !doc.collection;
            }));

        showOpen = (apps.length > 0);

        if (selection.length > 1) {
            showPrint = false;
            showProperties = false;
        }

        let openLabel = null;
        if (apps.length == 1) {
            // Translators: this is the Open action in a context menu
            openLabel = _("Open with %s").format(apps[0]);
        } else {
            // Translators: this is the Open action in a context menu
            openLabel = _("Open");
        }
        this._toolbarOpen.set_label(openLabel);

        this._toolbarPrint.set_sensitive(showPrint);
        this._toolbarProperties.set_sensitive(showProperties);
        this._toolbarTrash.set_sensitive(showTrash);
        this._toolbarOpen.set_sensitive(showOpen);
        this._toolbarShare.set_sensitive(showShare);
        this._toolbarCollection.set_sensitive(showCollection);

        this._insideRefresh = false;
    },

    _onToolbarCollection: function() {
        let toplevel = this.widget.get_toplevel();
        if (!toplevel.is_toplevel())
            return;

        let dialog = new OrganizeCollectionDialog(toplevel);

        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                dialog.widget.destroy();
                Application.selectionController.setSelectionMode(false);
            }));
    },

    _onToolbarOpen: function(widget) {
        let selection = Application.selectionController.getSelection();
        Application.selectionController.setSelectionMode(false);

        selection.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);
                doc.open(widget.get_screen(), Gtk.get_current_event_time());
            }));
    },

    _onToolbarTrash: function(widget) {
        let selection = Application.selectionController.getSelection();
        Application.selectionController.setSelectionMode(false);

        selection.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);
                doc.trash();
            }));
    },

    _onToolbarProperties: function(widget) {
        let selection = Application.selectionController.getSelection();
        let dialog = new Properties.PropertiesDialog(selection[0]);

        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                dialog.widget.destroy();
                Application.selectionController.setSelectionMode(false);
            }));
    },

   _onToolbarShare: function(widget) {
       let dialog = new Sharing.SharingDialog();

       dialog.widget.connect('response', Lang.bind(this,
           function(widget, response) {
               if (response == Gtk.ResponseType.OK) {
                   dialog.widget.destroy();
                   Application.selectionController.setSelectionMode(false);
               }
           }));
    },

    _onToolbarPrint: function(widget) {
        let selection = Application.selectionController.getSelection();

        if (selection.length != 1)
            return;

        let doc = Application.documentManager.getItemById(selection[0]);
        doc.print(this.widget.get_toplevel());
    },
});
