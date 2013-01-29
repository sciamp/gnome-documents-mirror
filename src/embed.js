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
const Mainloop = imports.mainloop;
const Tweener = imports.util.tweener;

const Application = imports.application;
const MainToolbar = imports.mainToolbar;
const Notifications = imports.notifications;
const Preview = imports.preview;
const Edit = imports.edit;
const Selections = imports.selections;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

const Clutter = imports.gi.Clutter;
const EvView = imports.gi.EvinceView;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const _ = imports.gettext.gettext;

const _ICON_SIZE = 128;
const _PDF_LOADER_TIMEOUT = 400;

const SpinnerBox = new Lang.Class({
    Name: 'SpinnerBox',

    _init: function() {
        this._delayedMoveId = 0;

        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                     row_spacing: 24,
                                     hexpand: true,
                                     vexpand: true,
                                     halign: Gtk.Align.CENTER,
                                     valign: Gtk.Align.CENTER });

        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            opacity: 255,
                                            x_align: Clutter.ActorAlign.FILL,
                                            x_expand: true,
                                            y_align: Clutter.ActorAlign.FILL,
                                            y_expand: true });

        this._spinner = new Gtk.Spinner({ width_request: _ICON_SIZE,
                                          height_request: _ICON_SIZE,
                                          halign: Gtk.Align.CENTER,
                                          valign: Gtk.Align.CENTER });
        this.widget.add(this._spinner);

        this._label = new Gtk.Label({ label: '<big><b>' + _("Loading…") + '</b></big>',
                                      use_markup: true,
                                      halign: Gtk.Align.CENTER,
                                      valign: Gtk.Align.CENTER });
        this.widget.add(this._label);

        this.widget.connect('destroy', Lang.bind(this, this._clearDelayId));
        this.widget.show_all();
    },

    _clearDelayId: function() {
        if (this._delayedMoveId != 0) {
            Mainloop.source_remove(this._delayedMoveId);
            this._delayedMoveId = 0;
        }
    },

    moveIn: function() {
        this._clearDelayId();

        let parent = this.actor.get_parent();
        parent.set_child_above_sibling(this.actor, null);

        this._spinner.start();

        Tweener.addTween(this.actor, { opacity: 255,
                                       time: 0.30,
                                       transition: 'easeOutQuad' });
    },

    moveOut: function() {
        this._clearDelayId();

        Tweener.addTween(this.actor, { opacity: 0,
                                       time: 0.30,
                                       transition: 'easeOutQuad',
                                       onComplete: function () {
                                           let parent = this.actor.get_parent();
                                           parent.set_child_below_sibling(this.actor, null);

                                           this._spinner.stop();
                                       },
                                       onCompleteScope: this });
    },

    moveInDelayed: function(delay) {
        this._clearDelayId();

        this._delayedMoveId = Mainloop.timeout_add(delay, Lang.bind(this,
            function() {
                this._delayedMoveId = 0;

                this.moveIn();
                return false;
            }));
    }
});

const ErrorBox = new Lang.Class({
    Name: 'ErrorBox',

    _init: function(primary, secondary) {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                     row_spacing: 12,
                                     hexpand: true,
                                     vexpand: true,
                                     halign: Gtk.Align.CENTER,
                                     valign: Gtk.Align.CENTER });

        this._image = new Gtk.Image({ pixel_size: _ICON_SIZE,
                                      icon_name: 'face-uncertain-symbolic',
                                      halign: Gtk.Align.CENTER,
                                      valign: Gtk.Align.CENTER });

        this.widget.add(this._image);

        this._primaryLabel =
            new Gtk.Label({ label: '',
                            use_markup: true,
                            halign: Gtk.Align.CENTER,
                            valign: Gtk.Align.CENTER });
        this.widget.add(this._primaryLabel);

        this._secondaryLabel =
            new Gtk.Label({ label: '',
                            use_markup: true,
                            halign: Gtk.Align.CENTER,
                            valign: Gtk.Align.CENTER });
        this.widget.add(this._secondaryLabel);

        this.widget.show_all();

        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            opacity: 255,
                                            x_align: Clutter.ActorAlign.FILL,
                                            x_expand: true,
                                            y_align: Clutter.ActorAlign.FILL,
                                            y_expand: true });
    },

    update: function(primary, secondary) {
        let primaryMarkup = '<big><b>' + GLib.markup_escape_text(primary, -1) + '</b></big>';
        let secondaryMarkup = GLib.markup_escape_text(secondary, -1);

        this._primaryLabel.label = primaryMarkup;
        this._secondaryLabel.label = secondaryMarkup;
    },

    moveIn: function() {
        let parent = this.actor.get_parent();
        parent.set_child_above_sibling(this.actor, null);

        Tweener.addTween(this.actor, { opacity: 255,
                                       time: 0.30,
                                       transition: 'easeOutQuad' });
    },

    moveOut: function() {
        Tweener.addTween(this.actor, { opacity: 0,
                                       time: 0.30,
                                       transition: 'easeOutQuad',
                                       onComplete: function () {
                                           let parent = this.actor.get_parent();
                                           parent.set_child_below_sibling(this.actor, null);
                                       },
                                       onCompleteScope: this });
    }
});

const EmptyResultsBox = new Lang.Class({
    Name: 'EmptyResultsBox',

    _init: function() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                     column_spacing: 12,
                                     hexpand: true,
                                     vexpand: true,
                                     halign: Gtk.Align.CENTER,
                                     valign: Gtk.Align.CENTER });
        this.widget.get_style_context().add_class('dim-label');

        this._image = new Gtk.Image({ pixel_size: 64,
                                      icon_name: 'emblem-documents-symbolic' });
        this.widget.add(this._image);

        this._labelsGrid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                          row_spacing: 12 });
        this.widget.add(this._labelsGrid);

        let titleLabel = new Gtk.Label({ label: '<b><span size="large">' +
                                         _("No Documents Found") +
                                         '</span></b>',
                                         use_markup: true,
                                         halign: Gtk.Align.START,
                                         vexpand: true });
        this._labelsGrid.add(titleLabel);

        if (Application.sourceManager.hasOnlineSources()) {
            titleLabel.valign = Gtk.Align.CENTER;
        } else {
            titleLabel.valign = Gtk.Align.START;
            this._addSystemSettingsLabel();
        }

        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            opacity: 255 });
        this.widget.show_all();
    },

    _addSystemSettingsLabel: function() {
        let detailsStr =
            // Translators: %s here is "System Settings", which is in a separate string
            // due to markup, and should be translated only in the context of this sentence
            _("You can add your online accounts in %s").format(
            " <a href=\"system-settings\">" +
            // Translators: this should be translated in the context of the
            // "You can add your online accounts in System Settings" sentence above
            _("System Settings") +
            "</a>");
        let details = new Gtk.Label({ label: detailsStr,
                                      use_markup: true,
                                      halign: Gtk.Align.START,
                                      xalign: 0,
                                      max_width_chars: 24,
                                      wrap: true });
        this._labelsGrid.add(details);

        details.connect('activate-link', Lang.bind(this,
            function(label, uri) {
                if (uri != 'system-settings')
                    return false;

                try {
                    let app = Gio.AppInfo.create_from_commandline(
                        'gnome-control-center online-accounts', null, 0);

                    let screen = this.widget.get_screen();
                    let display = screen ? screen.get_display() : Gdk.Display.get_default();
                    let ctx = display.get_app_launch_context();

                    if (screen)
                        ctx.set_screen(screen);

                    app.launch([], ctx);
                } catch(e) {
                    log('Unable to launch gnome-control-center: ' + e.message);
                }

                return true;
            }));
    }
});

const EmbedWidget = new Lang.Class({
    Name: 'EmbedWidget',
    Extends: GtkClutter.Embed,

    _init: function() {
        this.parent({ use_layout_size: true,
                      can_focus: false });
    },

    /* We overide all keyboard handling of GtkClutter.Embed, as it interfers
     * with the key event propagation and thus focus navigation in gtk+.
     * We also make the embed itself non-focusable, as we want to treat it
     * like a container of Gtk+ widget rather than an edge widget which gets
     * keyboard events.
     * This means we will never get any Clutter key events, but that is
     * fine, as all our keyboard input is into GtkClutterActors, and clutter
     * is just used as a nice way of animating and rendering Gtk+ widgets
     * and some non-active graphical things.
     */
    vfunc_key_press_event: function(event) {
        return false;
    },

    vfunc_key_release_event: function(event) {
        return false;
    }
});

const Embed = new Lang.Class({
    Name: 'Embed',

    _init: function() {
        this._queryErrorId = 0;
        this._noResultsChangeId = 0;

        this.widget = new EmbedWidget();
        this.widget.show();

        // the embed is a vertical ClutterBox
        let stage = this.widget.get_stage();
        this._overlayLayout = new Clutter.BinLayout();
        this.actor = new Clutter.Box({ layout_manager: this._overlayLayout });
        this.actor.add_constraint(
            new Clutter.BindConstraint({ coordinate: Clutter.BindCoordinate.SIZE,
                                         source: stage }));
        stage.add_actor(this.actor);

        this._contentsLayout = new Clutter.BoxLayout({ vertical: true });
        this._contentsActor = new Clutter.Box({ layout_manager: this._contentsLayout });
        this._overlayLayout.add(this._contentsActor,
            Clutter.BinAlignment.FILL, Clutter.BinAlignment.FILL);

        // pack the main GtkNotebook and a spinnerbox in a BinLayout, so that
        // we can easily bring them front/back
        this._viewLayout = new Clutter.BinLayout();
        this._viewActor = new Clutter.Box({ layout_manager: this._viewLayout });
        this._contentsLayout.set_expand(this._viewActor, true);
        this._contentsLayout.set_fill(this._viewActor, true, true);
        this._contentsActor.add_actor(this._viewActor);

        this._notebook = new Gtk.Notebook({ show_tabs: false,
                                            show_border: false });
        this._notebook.show();
        this._notebookActor = new GtkClutter.Actor({ contents: this._notebook,
                                                     x_align: Clutter.ActorAlign.FILL,
                                                     x_expand: true,
                                                     y_align: Clutter.ActorAlign.FILL,
                                                     y_expand: true });
        this._viewActor.add_child(this._notebookActor);

        this._spinnerBox = new SpinnerBox();
        this._viewActor.insert_child_below(this._spinnerBox.actor, null);

        this._errorBox = new ErrorBox();
        this._viewActor.insert_child_below(this._errorBox.actor,  null);

        this._noResults = new EmptyResultsBox();
        this._viewLayout.add(this._noResults.actor, Clutter.BinAlignment.FILL, Clutter.BinAlignment.FILL);
        this._noResults.actor.lower_bottom();

        // create the OSD toolbar for selected items, it's hidden by default
        this._selectionToolbar = new Selections.SelectionToolbar(this._contentsActor);
        this._overlayLayout.add(this._selectionToolbar.actor,
            Clutter.BinAlignment.FIXED, Clutter.BinAlignment.FIXED);

        // pack the OSD notification actor
        this._viewActor.add_child(Application.notificationManager.actor);

        // now create the actual content widgets
        this._view = new View.ViewContainer();
        this._viewPage = this._notebook.append_page(this._view.widget, null);

        this._preview = new Preview.PreviewView(this._overlayLayout);
        this._previewPage = this._notebook.append_page(this._preview.widget, null);

        this._edit = new Edit.EditView(this._overlayLayout);
        this._editPage = this._notebook.append_page(this._edit.widget, null);

        Application.modeController.connect('window-mode-changed',
                                           Lang.bind(this, this._onWindowModeChanged));

        Application.modeController.connect('fullscreen-changed',
                                           Lang.bind(this, this._onFullscreenChanged));
        Application.trackerController.connect('query-status-changed',
                                              Lang.bind(this, this._onQueryStatusChanged));
        Application.trackerController.connect('query-error',
                                              Lang.bind(this, this._onQueryError));

        Application.offsetController.connect('item-count-changed',
                                        Lang.bind(this, this._onItemCountChanged));

        Application.documentManager.connect('active-changed',
                                            Lang.bind(this, this._onActiveItemChanged));
        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));
        Application.documentManager.connect('load-error',
                                            Lang.bind(this, this._onLoadError));

        this._onQueryStatusChanged();

        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.NONE)
            this._onWindowModeChanged(Application.modeController, windowMode, WindowMode.WindowMode.NONE);
    },

    _onQueryStatusChanged: function() {
        let windowMode = Application.modeController.getWindowMode();
        if (windowMode != WindowMode.WindowMode.OVERVIEW)
            return;

        let queryStatus = Application.trackerController.getQueryStatus();

        if (queryStatus) {
            this._errorBox.moveOut();
            this._spinnerBox.moveIn();
        } else {
            this._spinnerBox.moveOut();
        }
    },

    _hideNoResultsPage: function() {
        if (this._noResultsChangeId != 0) {
            Application.changeMonitor.disconnect(this._noResultsChangeId);
            this._noResultsChangeId = 0;
        }

        this._noResults.actor.lower_bottom();
    },

    _onItemCountChanged: function() {
        let itemCount = Application.offsetController.getItemCount();

        if (itemCount == 0) {
            // also listen to changes-pending while in this mode
            this._noResultsChangeId =
                Application.changeMonitor.connect('changes-pending', Lang.bind(this,
                    function() {
                        this._hideNoResultsPage();
                    }));

            this._noResults.actor.raise_top();
        } else {
            this._hideNoResultsPage();
        }
    },

    _onQueryError: function(manager, message, exception) {
        this._setError(message, exception.message);
    },

    _onFullscreenChanged: function(controller, fullscreen) {
        Gtk.Settings.get_default().gtk_application_prefer_dark_theme = fullscreen;
        this._toolbar.actor.visible = !fullscreen;
        this._toolbar.widget.sensitive = !fullscreen;
    },

    _onWindowModeChanged: function(object, newMode, oldMode) {
        switch (newMode) {
        case WindowMode.WindowMode.OVERVIEW:
            this._prepareForOverview();
            break;
        case WindowMode.WindowMode.PREVIEW:
            if (oldMode == WindowMode.WindowMode.EDIT)
                Application.documentManager.reloadActiveItem();
            this._prepareForPreview();
            break;
        case WindowMode.WindowMode.EDIT:
            this._prepareForEdit();
            break;
        case WindowMode.WindowMode.NONE:
            break;
         default:
            throw(new Error('Not handled'))
            break;
        }
    },

    _onActiveItemChanged: function(manager, doc) {
        let newMode = WindowMode.WindowMode.OVERVIEW;

        if (doc) {
            let collection = Application.collectionManager.getItemById(doc.id);
            if (!collection)
                newMode = WindowMode.WindowMode.PREVIEW;
        }

        Application.modeController.setWindowMode(newMode);
    },

    _onLoadStarted: function() {
        // switch to preview mode, and schedule the spinnerbox to
        // move in if the document is not loaded by the timeout
        this._spinnerBox.moveInDelayed(_PDF_LOADER_TIMEOUT);
    },

    _onLoadFinished: function(manager, doc, docModel) {
        docModel.set_sizing_mode(EvView.SizingMode.AUTOMATIC);
        docModel.set_page_layout(EvView.PageLayout.AUTOMATIC);
        this._toolbar.setModel(docModel);
        this._preview.setModel(docModel);
        this._preview.widget.grab_focus();

        this._spinnerBox.moveOut();
    },

    _onLoadError: function(manager, doc, message, exception) {
        this._spinnerBox.moveOut();
        this._setError(message, exception.message);
    },

    _prepareForOverview: function() {
        if (this._preview)
            this._preview.setModel(null);
        if (this._edit)
            this._edit.setUri(null);

        if (this._toolbar)
            this._toolbar.actor.destroy();

        // pack the toolbar
        this._toolbar = new MainToolbar.OverviewToolbar(this._viewLayout);
        this._contentsLayout.pack_start = true;
        this._contentsActor.add_actor(this._toolbar.actor);
        this._contentsLayout.set_fill(this._toolbar.actor, true, false);

        this._spinnerBox.moveOut();
        this._errorBox.moveOut();

        this._notebook.set_current_page(this._viewPage);
    },

    _prepareForPreview: function() {
        if (this._edit)
            this._edit.setUri(null);
        if (this._toolbar)
            this._toolbar.actor.destroy();

        // pack the toolbar
        this._toolbar = new Preview.PreviewToolbar(this._preview);
        this._contentsLayout.pack_start = true;
        this._contentsActor.add_actor(this._toolbar.actor);
        this._contentsLayout.set_fill(this._toolbar.actor, true, false);

        this._notebook.set_current_page(this._previewPage);
    },

    _prepareForEdit: function() {
        if (this._preview)
            this._preview.setModel(null);
        if (this._toolbar)
            this._toolbar.actor.destroy();

        // pack the toolbar
        this._toolbar = new Edit.EditToolbar(this._preview);
        this._contentsLayout.pack_start = true;
        this._contentsActor.add_actor(this._toolbar.actor);
        this._contentsLayout.set_fill(this._toolbar.actor, true, false);

        this._notebook.set_current_page(this._editPage);
    },

    _setError: function(primary, secondary) {
        this._errorBox.update(primary, secondary);
        this._errorBox.moveIn();
    },

    getMainToolbar: function() {
        let fullscreen = Application.modeController.getFullscreen();
        if (fullscreen)
            return this._preview.getFullscreenToolbar();
        else
            return this._toolbar;
    },

    getPreview: function() {
        return this._preview;
    }
});
