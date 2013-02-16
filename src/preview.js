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

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Tweener = imports.tweener.tweener;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Places = imports.places;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;
const WindowMode = imports.windowMode;
const Presentation = imports.presentation;

const _FULLSCREEN_TOOLBAR_TIMEOUT = 2; // seconds

const PreviewView = new Lang.Class({
    Name: 'PreviewView',

    _init: function(overlay) {
        this._model = null;
        this._jobFind = null;
        this._controlsFlipId = 0;
        this._controlsVisible = false;
        this._pageChanged = false;
        this._viewSelectionChanged = false;
        this._fsToolbar = null;
        this._overlay = overlay;
        this._lastSearch = '';
        this._loadError = false;

        Application.modeController.connect('fullscreen-changed', Lang.bind(this,
            this._onFullscreenChanged));
        Application.modeController.connect('window-mode-changed', Lang.bind(this,
            this._onWindowModeChanged));

        this.widget = new Gtk.ScrolledWindow({ hexpand: true,
                                               vexpand: true,
                                               shadow_type: Gtk.ShadowType.IN });
        this.widget.get_style_context().add_class('documents-scrolledwin');
        this.widget.get_hscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_vscrollbar().connect('button-press-event', Lang.bind(this, this._onScrollbarClick));
        this.widget.get_hadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));
        this.widget.get_vadjustment().connect('value-changed', Lang.bind(this, this._onAdjustmentChanged));

        this._createView();

        // create page nav bar
        this._navBar = new PreviewNavBar(this._model);
        this._overlay.add_overlay(this._navBar.widget);

        // create page nav buttons
        this._navButtons = new PreviewNavButtons(this._model, this._overlay);

        this.widget.show_all();

        Application.application.connect('action-state-changed::bookmark-page',
            Lang.bind(this, this._onActionStateChanged));
        this._onActionStateChanged(Application.application, 'bookmark-page',
            Application.application.get_action_state('bookmark-page'));

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
        let showPlaces = Application.application.lookup_action('places');
        showPlaces.connect('activate', Lang.bind(this, this._showPlaces));

        this._togglePresentation = Application.application.lookup_action('present-current');
        Application.application.connect('action-state-changed::present-current',
            Lang.bind(this, this._onPresentStateChanged));

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));
    },

    _onLoadStarted: function() {
        this._showPlaces.enabled = false;
    },

    _onLoadFinished: function(manager, doc, docModel) {
        this._showPlaces.enabled = true;
        this._togglePresentation.enabled = true;

        if (!Application.documentManager.metadata)
            return;

        this._navButtons.show();

        this._bookmarks = new GdPrivate.Bookmarks({ metadata: Application.documentManager.metadata });
    },

    _onLoadError: function(manager, doc, message, exception) {
        this._controlsVisible = true;

        this._loadError = true;
        this._syncControlsVisible();
        this._loadError = false;
    },

    _onActionStateChanged: function(source, actionName, state) {
        if (!this._model)
            return;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });

        if (state.get_boolean())
            this._bookmarks.add(bookmark);
        else
            this._bookmarks.remove(bookmark);
    },

    _onPresentStateChanged: function(source, actionName, state) {
        if (!this._model)
            return;

        if (state.get_boolean())
            this._promptPresentation();
        else
            this._hidePresentation();
    },

    _onPageChanged: function() {
        this._pageChanged = true;

        let page_number = this._model.page;
        let bookmark = new GdPrivate.Bookmark({ page_number: page_number });
        let hasBookmark = (this._bookmarks.find_bookmark(bookmark) != null);

        Application.application.change_action_state('bookmark-page', GLib.Variant.new('b', (hasBookmark)));
    },

    _showPlaces: function() {
        let dialog = new Places.PlacesDialog(this._model, this._bookmarks);
        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _hidePresentation: function() {
        if (this._presentation) {
            this._presentation.close();
            this._presentation = null;
        }

        Application.application.change_action_state('present-current', GLib.Variant.new('b', false));
    },

    _showPresentation: function(output) {
        this._presentation = new Presentation.PresentationWindow(this._model);
        this._presentation.window.connect('destroy', Lang.bind(this, this._hidePresentation));
        if (output)
            this._presentation.setOutput(output);
    },

    _promptPresentation: function() {
        let outputs = new Presentation.PresentationOutputs();
        if (outputs.list.length < 2) {
            this._showPresentation();
        } else {
            let chooser = new Presentation.PresentationOutputChooser(outputs);
            chooser.connect('output-activated', Lang.bind(this,
                function(chooser, output) {
                    if (output) {
                        this._showPresentation(output);
                    } else {
                        this._hidePresentation();
                    }
                }));

        }
    },

    _onViewSelectionChanged: function() {
        this._viewSelectionChanged = true;
        if (!this.view.get_has_selection())
            this._cancelControlsFlip();
    },

    _uriRewrite: function(uri) {
        if (uri.substring(0, 3) != 'www.') {
            /* Prepending "http://" when the url is a webpage (starts with
             * "www.").
             */
            uri = 'http://' + uri;
        } else {
            /* Or treating as a file, otherwise.
             * http://en.wikipedia.org/wiki/File_URI_scheme
             */
            let doc = Application.documentManager.getActiveItem();
            let file = Gio.file_new_for_uri(doc.uri);
            let parent = file.get_parent();

            if (parent)
                uri = parent.get_uri() + uri;
            else
                uri = 'file:///' + uri;
        }

        return uri;
    },

    _launchExternalUri: function(widget, action) {
        let uri = action.get_uri();
        let screen = widget.get_screen();
        let context = screen.get_display().get_app_launch_context();

        context.set_screen(screen);
        context.set_timestamp(Gtk.get_current_event_time());

        if (uri.indexOf('://') == -1 && uri.substring(0, 6) != 'mailto:')
            /* We are only interested in treat URLs (ignoring URN and Mailto
             * schemes), which have this syntax scheme:
             * scheme://domain:port/path?query_string#fragment_id
             *
             * So, if the url is bad formed (doesn't contain "://"), we need to
             * rewrite it.
             *
             * An example of URL, URN and Mailto schemes can be found in:
             * http://en.wikipedia.org/wiki/URI_scheme#Examples
             */
            uri = this._uriRewrite(uri);

        try {
            Gio.AppInfo.launch_default_for_uri(uri, context)
        } catch (e) {
            log('Unable to open external link: ' + e.message);
        }
    },

    _handleExternalLink: function(widget, action) {
        if (action.type == EvDocument.LinkActionType.EXTERNAL_URI)
            this._launchExternalUri(widget, action);
    },

    _onCanZoomInChanged: function() {
        this._zoomIn.enabled = this.view.can_zoom_in;
    },

    _onCanZoomOutChanged: function() {
        this._zoomOut.enabled = this.view.can_zoom_out;
    },

    _createView: function() {
        this.view = EvView.View.new();
        this.widget.add(this.view);
        this.view.show();

        this.view.connect('notify::can-zoom-in', Lang.bind(this,
            this._onCanZoomInChanged));
        this.view.connect('notify::can-zoom-out', Lang.bind(this,
            this._onCanZoomOutChanged));
        this.view.connect('button-press-event', Lang.bind(this,
            this._onButtonPressEvent));
        this.view.connect('button-release-event', Lang.bind(this,
            this._onButtonReleaseEvent));
        this.view.connect('key-press-event', Lang.bind(this,
            this._onKeyPressEvent));
        this.view.connect('selection-changed', Lang.bind(this,
            this._onViewSelectionChanged));
        this.view.connect('external-link', Lang.bind(this,
            this._handleExternalLink));
    },

    _syncControlsVisible: function() {
        if (this._controlsVisible) {
            if (this._fsToolbar)
                this._fsToolbar.show();
            if (!this._loadError)
                this._navBar.show();
        } else {
            if (this._fsToolbar)
                this._fsToolbar.hide();
            this._navBar.hide();
        }
    },

    _onWindowModeChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.PREVIEW) {
            this.controlsVisible = false;
            this._hidePresentation();
            this._navButtons.hide();
        }
    },

    _onFullscreenChanged: function() {
        let fullscreen = Application.modeController.getFullscreen();

        if (fullscreen) {
            // create fullscreen toolbar (hidden by default)
            this._fsToolbar = new PreviewFullscreenToolbar(this);
            this._fsToolbar.setModel(this._model);
            this._overlay.add_overlay(this._fsToolbar.revealer);

            this._fsToolbar.connect('show-controls', Lang.bind(this,
                function() {
                    this.controlsVisible = true;
                }));
        } else {
            this._fsToolbar.revealer.destroy();
            this._fsToolbar = null;
        }

        this._syncControlsVisible();
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

    _flipControlsTimeout: function() {
        this._controlsFlipId = 0;
        let visible = this.controlsVisible;
        this.controlsVisible = !visible;

        return false;
    },

     _cancelControlsFlip: function() {
         if (this._controlsFlipId != 0) {
             Mainloop.source_remove(this._controlsFlipId);
             this._controlsFlipId = 0;
         }
     },

     _queueControlsFlip: function() {
         if (this._controlsFlipId)
             return;

         let settings = Gtk.Settings.get_default();
         let doubleClick = settings.gtk_double_click_time;

         this._controlsFlipId = Mainloop.timeout_add(doubleClick, Lang.bind(this, this._flipControlsTimeout));
     },

    _onButtonPressEvent: function(widget, event) {

        this._viewSelectionChanged = false;

        return false;
   },

    _onButtonReleaseEvent: function(widget, event) {
        let button = event.get_button()[1];
        let clickCount = event.get_click_count()[1];

        if (button == 1
            && clickCount == 1
            && !this._viewSelectionChanged)
            this._queueControlsFlip();
        else
            this._cancelControlsFlip();

        this._viewSelectionChanged = false;

        return false;
    },

    _onScrollbarClick: function() {
        this.controlsVisible = false;
        return false;
    },

    _onAdjustmentChanged: function() {
        if (!this._pageChanged)
            this.controlsVisible = false;
        this._pageChanged = false;
    },

    _changeRotation: function(offset) {
        let rotation = this._model.get_rotation();
        this._model.set_rotation(rotation + offset);
    },

    get controlsVisible() {
        return this._controlsVisible;
    },

    set controlsVisible(visible) {
        // reset any pending timeout, as we're about to change controls state
        this._cancelControlsFlip();

        if (this._controlsVisible == visible)
            return;

        this._controlsVisible = visible;
        this._syncControlsVisible();
    },

    startSearch: function(str) {
        if (!this._model)
            return;

        if (this._jobFind) {
            if (!this._jobFind.is_finished())
                this._jobFind.cancel();
            this._jobFind = null;
        }

        this._lastSearch = str;

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
        this.emit('search-changed', job.has_results());
    },

    setModel: function(model) {
        if (this._model == model)
            return;

        if (this.view) {
            this.controlsVisible = false;
            this._lastSearch = '';
        }

        this._model = model;

        if (this._model) {
            this.view.set_model(this._model);
            this._navBar.setModel(model);
            this._navButtons.setModel(model);
            this._model.connect('page-changed', Lang.bind(this, this._onPageChanged));
        }
    },

    getModel: function() {
        return this._model;
    },

    getFullscreenToolbar: function() {
        return this._fsToolbar;
    },

    get lastSearch() {
        return this._lastSearch;
    }
});
Signals.addSignalMethods(PreviewView.prototype);

const _PREVIEW_NAVBAR_MARGIN = 30;

const PreviewNavBar = new Lang.Class({
    Name: 'PreviewNavBar',

    _init: function(model) {
        this._model = model;
        this.widget = new GdPrivate.NavBar({ document_model: model,
                                             margin: _PREVIEW_NAVBAR_MARGIN,
                                             valign: Gtk.Align.END,
                                             opacity: 0 });
        this.widget.get_style_context().add_class('osd');

        let button = new Gtk.Button({ action_name: 'app.places',
                                      child: new Gtk.Image({ icon_name: 'view-list-symbolic',
                                                             pixel_size: 16 }),
                                      valign: Gtk.Align.CENTER
                                    });
        let buttonArea = this.widget.get_button_area();
        buttonArea.pack_start(button, false, false, 0);

        button = new Gtk.ToggleButton({ action_name: 'app.bookmark-page',
                                        child: new Gtk.Image({ icon_name: 'bookmark-add-symbolic',
                                                               pixel_size: 16 }),
                                        valign: Gtk.Align.CENTER
                                      });
        buttonArea.pack_start(button, false, false, 0);
    },

    setModel: function(model) {
        this._model = model;
        this.widget.document_model = model;
        if (!model)
            this.hide();
    },

    show: function() {
        if (!this._model)
            return;

        this.widget.show_all();
        Tweener.addTween(this.widget, { opacity: 1,
                                        time: 0.30,
                                        transition: 'easeOutQuad' });
    },

    hide: function() {
        Tweener.addTween(this.widget, { opacity: 0,
                                        time: 0.30,
                                        transition: 'easeOutQuad',
                                        onComplete: function() {
                                            this.widget.hide();
                                        },
                                        onCompleteScope: this });
    }
});

const _AUTO_HIDE_TIMEOUT = 2;
const PreviewNavButtons = new Lang.Class({
    Name: 'PreviewNavButtons',

    _init: function(model, overlay) {
        this._model = model;
        this._overlay = overlay;
        this._visible = false;
        this._pageChangedId = 0;
        this._autoHideId = 0;
        this._motionId = 0;
        this._hover = false;

        this.prev_widget = new Gtk.Button({ child: new Gtk.Image ({ icon_name: 'go-previous-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_left: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.START,
                                            valign: Gtk.Align.CENTER });
        this.prev_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.prev_widget);
        this.prev_widget.connect('clicked', Lang.bind(this, this._onPrevClicked));
        this.prev_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.prev_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this.next_widget = new Gtk.Button({ child: new Gtk.Image ({ icon_name: 'go-next-symbolic',
                                                                    pixel_size: 16 }),
                                            margin_right: _PREVIEW_NAVBAR_MARGIN,
                                            halign: Gtk.Align.END,
                                            valign: Gtk.Align.CENTER });
        this.next_widget.get_style_context().add_class('osd');
        this._overlay.add_overlay(this.next_widget);
        this.next_widget.connect('clicked', Lang.bind(this, this._onNextClicked));
        this.next_widget.connect('enter-notify-event', Lang.bind(this, this._onEnterNotify));
        this.next_widget.connect('leave-notify-event', Lang.bind(this, this._onLeaveNotify));

        this._overlay.connect('motion-notify-event', Lang.bind(this, this._onMotion));

    },

    _onEnterNotify: function() {
        this._hover = true;
        this._unqueueAutoHide();
        return false;
    },

    _onLeaveNotify: function() {
        this._hover = false;
        this._queueAutoHide();
        return false;
    },

    _motionTimeout: function() {
        this._motionId = 0;
        this._updateVisibility();
        return false;
    },

    _onMotion: function() {
        if (this._motionId != 0) {
            return false;
        }

        this._motionId = Mainloop.idle_add(Lang.bind(this, this._motionTimeout));
        return false;
    },

    _onPrevClicked: function() {
        if (this._model.page > 0)
            this._model.page--;
    },

    _onNextClicked: function() {
        let doc = this._model.document;
        if (doc.get_n_pages() > this._model.page + 1)
            this._model.page++;
    },

    _autoHide: function() {
        this._fadeOutButton(this.prev_widget);
        this._fadeOutButton(this.next_widget);
        this._autoHideId = 0;
        return false;
    },

    _unqueueAutoHide: function() {
        if (this._autoHideId == 0)
            return;

        Mainloop.source_remove(this._autoHideId);
        this._autoHideId = 0;
    },

    _queueAutoHide: function() {
        this._unqueueAutoHide();
        this._autoHideId = Mainloop.timeout_add_seconds(_AUTO_HIDE_TIMEOUT, Lang.bind(this, this._autoHide));
    },

    _updateVisibility: function() {
        if (!this._model || !this._visible) {
            this._fadeOutButton(this.prev_widget);
            this._fadeOutButton(this.next_widget);
            return;
        }

        if (this._model.page > 0)
            this._fadeInButton(this.prev_widget);
        else
            this._fadeOutButton(this.prev_widget);

        let doc = this._model.document;
        if (doc.get_n_pages() > this._model.page + 1)
            this._fadeInButton(this.next_widget);
        else
            this._fadeOutButton(this.next_widget);

        if (!this._hover)
            this._queueAutoHide();
    },

    setModel: function(model) {
        if (this._pageChangedId != 0) {
            this._model.disconnect(this._pageChangedId);
            this._pageChangedId = 0;
        }

        this._model = model;

        if (this._model)
            this._pageChangedId = this._model.connect('page-changed', Lang.bind(this, this._updateVisibility));

        this._updateVisibility();
    },

    _fadeInButton: function(widget) {
        if (!this._model)
            return;
        widget.show_all();
        Tweener.addTween(widget, { opacity: 1,
                                   time: 0.30,
                                   transition: 'easeOutQuad' });
    },

    _fadeOutButton: function(widget) {
        Tweener.addTween(widget, { opacity: 0,
                                   time: 0.30,
                                   transition: 'easeOutQuad',
                                   onComplete: function() {
                                       widget.hide();
                                   },
                                   onCompleteScope: this });
    },

    show: function() {
        this._visible = true;
        this._fadeInButton(this.prev_widget);
        this._fadeInButton(this.next_widget);
    },

    hide: function() {
        this._visible = false;
        this._fadeOutButton(this.prev_widget);
        this._fadeOutButton(this.next_widget);
    },
});

const PreviewToolbar = new Lang.Class({
    Name: 'PreviewToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(previewView) {
        this._previewView = previewView;

        this.parent();

        this._searchAction = Application.application.lookup_action('search');
        this._gearMenu = Application.application.lookup_action('gear-menu');

        // back button, on the left of the toolbar
        let iconName =
            (this.toolbar.get_direction() == Gtk.TextDirection.RTL) ?
            'go-next-symbolic' : 'go-previous-symbolic';
        let backButton =
            this.toolbar.add_button(iconName, _("Back"), true);
        backButton.connect('clicked', Lang.bind(this,
            function() {
                Application.documentManager.setActiveItem(null);
                this._searchAction.enabled = true;
            }));

        // search button, on the right of the toolbar
        this.addSearchButton();

        // menu button, on the right of the toolbar
        let previewMenu = this._getPreviewMenu();
        let menuButton = this.toolbar.add_menu('emblem-system-symbolic', null, false);
        menuButton.set_menu_model(previewMenu);
        menuButton.set_action_name('app.gear-menu');

        this._setToolbarTitle();
        this.toolbar.show_all();

        let loadStartId =
            Application.documentManager.connect('load-started',
                Lang.bind(this, this._onLoadStarted));
        let loadFinishId =
            Application.documentManager.connect('load-finished',
                Lang.bind(this, this._onLoadFinished));

        this.widget.connect('destroy',
            function() {
                Application.documentManager.disconnect(loadStartId);
                Application.documentManager.disconnect(loadFinishId);
            });
    },

    _onLoadStarted: function() {
        this._gearMenu.enabled = false;
        this._searchAction.enabled = false;
    },

    _onLoadFinished: function() {
        this._gearMenu.enabled = true;
        this._searchAction.enabled = true;
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
        return new PreviewSearchbar(this._previewView);
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.toolbar.set_labels(primary, null);
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
        this._previewView.connect('search-changed', Lang.bind(this, this._onSearchChanged));

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

        this._prev = new Gtk.Button({ action_name: 'app.find-prev' });
        this._prev.set_image(new Gtk.Image({ icon_name: 'go-up-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._prev.set_tooltip_text(_("Find Previous"));
        controlsBox.add(this._prev);

        this._next = new Gtk.Button({ action_name: 'app.find-next' });
        this._next.set_image(new Gtk.Image({ icon_name: 'go-down-symbolic',
                                             icon_size: Gtk.IconSize.MENU,
                                             margin: 2 }));
        this._next.set_tooltip_text(_("Find Next"));
        controlsBox.add(this._next);

        this._onSearchChanged(this._previewView, false);
    },

    _onSearchChanged: function(view, hasResults) {
        let findPrev = Application.application.lookup_action('find-prev');
        let findNext = Application.application.lookup_action('find-next');
        findPrev.enabled = hasResults;
        findNext.enabled = hasResults;
    },

    entryChanged: function() {
        this._previewView.view.find_search_changed();
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    show: function() {
        this.parent();

        if (!this._searchEntry.get_text()) {
            this._searchEntry.set_text(this._previewView.lastSearch);
            this._searchEntry.select_region(0, -1);
        }

        this._previewView.view.find_set_highlight_search(true);
        this._previewView.startSearch(this._searchEntry.get_text());
    },

    hide: function() {
        this._previewView.view.find_set_highlight_search(false);

        this.parent();
    }
});

const PreviewFullscreenToolbar = new Lang.Class({
    Name: 'PreviewFullscreenToolbar',
    Extends: PreviewToolbar,

    _init: function(previewView) {
        this.parent(previewView);

        this.revealer = new Gd.Revealer({ valign: Gtk.Align.START });
        this.revealer.add(this.widget);
        this.revealer.show();

        // make controls show when a toolbar action is activated in fullscreen
        let actionNames = ['gear-menu', 'search'];
        let signalIds = [];

        actionNames.forEach(Lang.bind(this,
            function(actionName) {
                let signalName = 'action-state-changed::' + actionName;
                let signalId = Application.application.connect(signalName, Lang.bind(this,
                    function(actionGroup, actionName, value) {
                        let state = value.get_boolean();
                        if (state)
                            this.emit('show-controls');
                    }));

                signalIds.push(signalId);
            }));

        this.widget.connect('destroy', Lang.bind(this,
            function() {
                signalIds.forEach(
                    function(signalId) {
                        Application.application.disconnect(signalId);
                    });
            }));
    },

    handleEvent: function(event) {
        let res = this.parent(event);
        if (res)
            this.emit('search-event-handled');
    },

    show: function() {
        this.revealer.set_reveal_child(true);
    },

    hide: function() {
        this.revealer.set_reveal_child(false);
        Application.application.change_action_state('search', GLib.Variant.new('b', false));
    }
});
Signals.addSignalMethods(PreviewFullscreenToolbar.prototype);
