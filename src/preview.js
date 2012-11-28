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

const Clutter = imports.gi.Clutter;
const EvView = imports.gi.EvinceView;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const Tweener = imports.util.tweener;
const MainToolbar = imports.mainToolbar;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;

const _FULLSCREEN_TOOLBAR_TIMEOUT = 2; // seconds

const PreviewView = new Lang.Class({
    Name: 'PreviewView',

    _init: function(overlayLayout) {
        this._model = null;
        this._jobFind = null;
        this._controlsVisible = false;
        this._selectionChanged = false;

        Application.modeController.connect('fullscreen-changed',
            Lang.bind(this, this._onFullscreenChanged));

        this.widget = new Gtk.ScrolledWindow({ hexpand: true,
                                               vexpand: true,
                                               shadow_type: Gtk.ShadowType.IN });
        this.widget.get_style_context().add_class('documents-scrolledwin');
        this.widget.get_hscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_vscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_hadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        this.widget.get_vadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));

        this._createView();

        // create thumb bar
        this._thumbBar = new PreviewThumbnails(this._model);
        overlayLayout.add(this._thumbBar.actor,
            Clutter.BinAlignment.FILL, Clutter.BinAlignment.END);
        this._thumbBar.view.connect('selection-changed', Lang.bind(this,
            function() {
                this._selectionChanged = true;
            }));

        // create fullscreen toolbar (hidden by default)
        this._fsToolbar = new PreviewFullscreenToolbar(this);
        this._fsToolbar.setModel(this._model);
        overlayLayout.add(this._fsToolbar.actor,
            Clutter.BinAlignment.FILL, Clutter.BinAlignment.START);

        this.widget.show_all();

        this._zoomIn = Application.application.lookup_action('zoom-in');
        this._zoomIn.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_in();
            }));

        this._zoomOut = Application.application.lookup_action('zoom-out');
        this._zoomOut.connect('activate', Lang.bind(this,
            function() {
                this._model.set_sizing_mode(EvView.SizingMode.FREE);
                this.view.zoom_out();
            }));

        this._findPrev = Application.application.lookup_action('find-prev');
        this._findPrev.connect('activate', Lang.bind(this,
            function() {
                this.view.find_previous();
            }));
        this._findNext = Application.application.lookup_action('find-next');
        this._findNext.connect('activate', Lang.bind(this,
            function() {
                this.view.find_next();
            }));

        let rotLeft = Application.application.lookup_action('rotate-left');
        rotLeft.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(-90);
            }));
        let rotRight = Application.application.lookup_action('rotate-right');
        rotRight.connect('activate', Lang.bind(this,
            function() {
                this._changeRotation(90);
            }));
    },

    _createView: function() {
        this.view = EvView.View.new();
        this.widget.add(this.view);
        this.view.show();

        this.view.connect('button-press-event',
                            Lang.bind(this, this._onButtonPressEvent));
        this.view.connect('button-release-event',
                            Lang.bind(this, this._onButtonReleaseEvent));
        this.view.connect('key-press-event',
                            Lang.bind(this, this._onKeyPressEvent));
    },

    _flipControlsState: function() {
        this._controlsVisible = !this._controlsVisible;
        if (this._controlsVisible) {
            if (Application.modeController.getFullscreen())
                this._fsToolbar.show();
            this._thumbBar.show();
        } else {
            this._fsToolbar.hide();
            this._thumbBar.hide();
        }
    },

    _onFullscreenChanged: function() {
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen && this._controlsVisible)
            this._fsToolbar.show();
        else if (!fullscreen)
            this._fsToolbar.hide();
    },

    _onKeyPressEvent: function(widget, event) {
        let keyval = event.get_keyval()[1];
        let state = event.get_state()[1];

        if ((keyval == Gdk.KEY_Page_Up) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) {
            this.view.previous_page();
            return true;
        }

        if ((keyval == Gdk.KEY_Page_Down) &&
            ((state & Gdk.ModifierType.CONTROL_MASK) != 0)) {
            this.view.next_page();
            return true;
        }

        if (keyval == Gdk.KEY_Page_Up) {
            this.view.scroll(Gtk.ScrollType.PAGE_BACKWARD, false);
            return true;
        }

        if (keyval == Gdk.KEY_space ||
            keyval == Gdk.KEY_Page_Down) {
            this.view.scroll(Gtk.ScrollType.PAGE_FORWARD, false);
            return true;
        }

        return false;
     },

    _onButtonPressEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1 && clickCount == 2) {
            Application.modeController.toggleFullscreen();
            return true;
        }

        return false;
    },

    _onButtonReleaseEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1 && clickCount == 1)
            this._flipControlsState();

        return false;
    },

    _onScrollbarClick: function() {
        if (this._controlsVisible)
            this._flipControlsState();

        return false;
    },

    _onAdjustmentChanged: function() {
        if (this._controlsVisible && !this._selectionChanged)
            this._flipControlsState();
        this._selectionChanged = false;
    },

    _changeRotation: function(offset) {
        let rotation = this._model.get_rotation();
        this._model.set_rotation(rotation + offset);
    },

    startSearch: function(str) {
        if (!this._model)
            return;

        if (this._jobFind) {
            if (!this._jobFind.is_finished())
                this._jobFind.cancel();
            this._jobFind = null;
        }

        if (!str) {
            this.view.queue_draw();
            return;
        }

        let evDoc = this._model.get_document();
        this._jobFind = EvView.JobFind.new(evDoc, this._model.get_page(), evDoc.get_n_pages(),
                                           str, false);
        this._jobFind.connect('updated', Lang.bind(this, this._onSearchJobUpdated));

        this._jobFind.scheduler_push_job(EvView.JobPriority.PRIORITY_NONE);
    },

    _onSearchJobUpdated: function(job, page) {
        // FIXME: ev_job_find_get_results() returns a GList **
        // and thus is not introspectable
        GdPrivate.ev_view_find_changed(this.view, job, page);
    },

    setModel: function(model) {
        if (this._model == model)
            return;

        if (this.view) {
            this.view.destroy();
            this._thumbBar.hide();
            this._fsToolbar.hide();
        }

        this._model = model;

        if (this._model) {
            this._createView();
            this.view.set_model(this._model);
            this._thumbBar.view.model = model;
            this._fsToolbar.setModel(model);
        }
    },

    getModel: function() {
        return this._model;
    }
});

const PreviewThumbnails = new Lang.Class({
    Name: 'PreviewThumbnails',

    _init: function(model) {
        this.view = new GdPrivate.SidebarThumbnails({ model: model,
                                                      visible: true });
        this.widget = new GdPrivate.ThumbNav({ thumbview: this.view,
                                               show_buttons: false });
        this.widget.get_style_context().add_class('osd');
        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            visible: false,
                                            opacity: 0 });
        Utils.alphaGtkWidget(this.actor.get_widget());

        this.widget.show();
    },

    show: function() {
        this.actor.show();

        Tweener.addTween(this.actor,
            { opacity: 255,
              time: 0.30,
              transition: 'easeOutQuad' });
    },

    hide: function() {
        Tweener.addTween(this.actor,
            { opacity: 0,
              time: 0.30,
              transition: 'easeOutQuad',
              onComplete: function() {
                  this.actor.hide();
              },
              onCompleteScope: this });
    }
});

const PreviewToolbar = new Lang.Class({
    Name: 'PreviewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();

        // back button, on the left of the toolbar
        let iconName =
            (this.widget.get_direction() == Gtk.TextDirection.RTL) ?
            'go-next-symbolic' : 'go-previous-symbolic';
        let backButton =
            this.widget.add_button(iconName, _("Back"), true);
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
            }));

        // search button, on the right of the toolbar
        this.addSearchButton();

        // menu button, on the right of the toolbar
        let previewMenu = this._getPreviewMenu();
        let menuButton = this.widget.add_menu('emblem-system-symbolic', null, false);
        menuButton.set_menu_model(previewMenu);
        menuButton.set_action_name('app.gear-menu');

        this._setToolbarTitle();
        this.widget.show_all();
    },

    _getPreviewMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/preview-menu.ui');
        let menu = builder.get_object('preview-menu');

        let doc = Application.documentManager.getActiveItem();
        if (doc && doc.defaultAppName) {
            let section = builder.get_object('open-section');
            section.remove(0);
            section.prepend(_("Open with %s").format(doc.defaultAppName), 'app.open-current');
        }

        return menu;
    },

    createSearchbar: function() {
        this._searchbar = new PreviewSearchbar(this._previewView);
        this.layout.pack_start = false;
        this.layout.pack(this._searchbar.actor, false, true, false,
                         Clutter.BoxAlignment.CENTER, Clutter.BoxAlignment.START);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.widget.set_labels(primary, null);
    },

    setModel: function(model) {
        if (!model)
            return;

        this._model = model;
        this._setToolbarTitle();
    }
});

const PreviewSearchbar = new Lang.Class({
    Name: 'PreviewSearchbar',
    Extends: Searchbar.Searchbar,

    _init: function(previewView) {
        this._previewView = previewView;
        this._lastText = '';

        this.parent();
    },

    createSearchWidgets: function() {
        this._searchContainer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                              spacing: 6,
                                              halign: Gtk.Align.CENTER});

        this._searchEntry = new Gtk.SearchEntry({ width_request: 500 });
        this._searchEntry.connect('activate', Lang.bind(this,
            function() {
                Application.application.activate_action('find-next', null);
            }));
        this._searchContainer.add(this._searchEntry);

        let controlsBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        controlsBox.get_style_context().add_class('linked');
        controlsBox.get_style_context().add_class('raised');
        this._searchContainer.add(controlsBox);

        let prev = new Gtk.Button({ action_name: 'app.find-prev' });
        prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                       icon_size: Gtk.IconSize.MENU,
                                       margin: 2 }));
        prev.set_tooltip_text(_("Find Previous"));
        controlsBox.add(prev);

        let next = new Gtk.Button({ action_name: 'app.find-next' });
        next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                       icon_size: Gtk.IconSize.MENU,
                                       margin: 2 }));
        next.set_tooltip_text(_("Find Next"));
        controlsBox.add(next);
    },

    entryChanged: function() {
        this._previewView.view.find_search_changed();
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    show: function() {
        this.parent();

        if (!this._searchEntry.get_text()) {
            this._searchEntry.set_text(this._lastText);
            this._searchEntry.select_region(0, -1);
        }

        this._lastText = '';
        this._previewView.view.find_set_highlight_search(true);
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    hide: function() {
        this._previewView.view.find_set_highlight_search(false);
        this._lastText = this._searchEntry.get_text();

        this.parent();
    }
});

const PreviewFullscreenToolbar = new Lang.Class({
    Name: 'PreviewFullscreenToolbar',
    Extends: PreviewToolbar,

    _init: function(previewView) {
        this.parent(previewView);

        this.actor.visible = false;
        this.widget.sensitive = false;
        this.actor.y = -(this.widget.get_preferred_height()[1]);
    },

    show: function() {
        this.actor.show();
        this.widget.sensitive = true;
        Tweener.addTween(this.actor,
                         { y: 0,
                           time: 0.20,
                           transition: 'easeInQuad' });
    },

    hide: function() {
        Tweener.addTween(this.actor,
                         { y: -(this.widget.get_preferred_height()[1]),
                           time: 0.20,
                           transition: 'easeOutQuad',
                           onComplete: function() {
                               this.actor.hide();
                               this.widget.sensitive = false;
                           },
                           onCompleteScope: this });
    }
});
