/*
 * Copyright (c) 2013 Red Hat, Inc.
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
 */

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const GnomeDesktop = imports.gi.GnomeDesktop;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;

const PresentationWindow = new Lang.Class({
    Name: 'PresentationWindow',

    _init: function(model) {
        this._model = model;
        this._inhibitId = 0;

        let toplevel = Application.application.get_windows()[0];
        this.window = new Gtk.Window ({ type: Gtk.WindowType.TOPLEVEL,
                                        transient_for: toplevel,
                                        destroy_with_parent: true,
                                        title: _("Presentation"),
                                        hexpand: true });
        this.window.connect('key-press-event',
                            Lang.bind(this, this._onKeyPressEvent));

        this._model.connect('page-changed',
                            Lang.bind(this, this._onPageChanged));

        this._createView();
        this.window.fullscreen();
        this.window.show_all();
    },

    _onPageChanged: function() {
        this.view.current_page = this._model.page;
    },

    _onPresentationPageChanged: function() {
        this._model.page = this.view.current_page;
    },

    _onKeyPressEvent: function(widget, event) {
        let keyval = event.get_keyval()[1];
        if (keyval == Gdk.KEY_Escape)
            this.close();
    },

    setOutput: function(output) {
        this.window.move(output.x, output.y);
    },

    _createView: function() {
        let doc = this._model.get_document();
        let inverted = this._model.inverted_colors;
        let page = this._model.page;
        let rotation = this._model.rotation;
        this.view = new EvView.ViewPresentation({ document: doc,
                                                  current_page: page,
                                                  rotation: rotation,
                                                  inverted_colors: inverted });
        this.view.connect('finished', Lang.bind(this, this.close));
        this.view.connect('notify::current-page', Lang.bind(this, this._onPresentationPageChanged));

        this.window.add(this.view);
        this.view.show();

        this._inhibitIdle();
    },

    close: function() {
        this._uninhibitIdle();
        this.window.destroy();
    },

    _inhibitIdle: function() {
        this._inhibitId = Application.application.inhibit(null,
                                                          Gtk.ApplicationInhibitFlags.IDLE,
                                                          _("Running in presentation mode"));
    },

    _uninhibitIdle: function() {
        if (this._inhibitId == 0)
            return;

        Application.application.uninhibit(this._inhibitId);
        this._inhibitId = 0;
    }
});

const PresenterWindow = new Lang.Class({
    Name: 'PresenterWindow',

    _init: function(presentation_window) {
        this._presentation_window = presentation_window;
        this.window = new Gtk.Window ({ type: Gtk.WindowType.TOPLEVEL,
                                        transient_for: presentation_window.window,
                                        destroy_with_parent: true,
                                        title: _("Presenter console"),
                                        hexpand: true });
        this.window.connect('key-press-event',
                            Lang.bind(this, this._onKeyPressEvent));
        this._createView();
        this.window.fullscreen();
        this.window.show_all();
    },

    _onKeyPressEvent: function(widget, event) {
        let keyval = event.get_keyval()[1];
        if (keyval == Gdk.KEY_Escape)
            this.close();
    },

    close: function() {
        this.window.destroy();
        this._presentation_window.close();
    },

    _createView: function() {
        this.view = new EvView.ViewPresenter({ presentation: this._presentation_window.view });
        // this.view.connect('finished', Lang.bind(this, this.close));

        this.window.add(this.view);
        this.view.show();
    },

    setOutput: function(output) {
        this.window.move(output.x, output.y);
    }
});

const PresentationOutputChooser = new Lang.Class({
    Name: 'PresentationOutputChooser',

    _init: function(outputs) {
        this.output = null;
        this._outputs = outputs;
        this._createWindow();
        this._populateList();
        this.window.show_all();
    },

    _populateList: function() {
        for (let i = 0; i < this._outputs.list.length; i++) {
            let output = this._outputs.list[i];
            let markup = '<b>' + output.display_name + '</b>';
            let label = new Gtk.Label({ label: markup,
                                        use_markup: true,
                                        margin_top: 5,
                                        margin_bottom: 5 });
            label.show();
            label.output = output;
            this._box.add(label);
        }
    },

    _onActivated: function(box, row) {
        this.output = row.get_child().output;
        this.emit('output-activated', this.output);
        this.close();
    },

    close: function() {
        this.window.destroy();
    },

    _createWindow: function() {
        let toplevel = Application.application.get_windows()[0];
        this.window = new Gtk.Dialog ({ resizable: true,
                                        modal: true,
                                        transient_for: toplevel,
                                        destroy_with_parent: true,
                                        title: _("Present On"),
                                        default_width: 300,
                                        default_height: 150,
                                        hexpand: true });
        this.window.connect('response', Lang.bind(this,
            function(widget, response) {
                this.emit('output-activated', null);
            }));

        this._box = new Gtk.ListBox({ valign: Gtk.Align.CENTER });
        this._box.connect('row-activated', Lang.bind(this, this._onActivated));
        let contentArea = this.window.get_content_area();
        contentArea.pack_start(this._box, true, false, 0);
    }
});
Signals.addSignalMethods(PresentationOutputChooser.prototype);

const PresentationOutput = new Lang.Class({
    Name: 'PresentationOutput',
    _init: function() {
        this.id = null;
        this.name = null;
        this.display_name = null;
        this.is_primary = false;
        this.x = 0;
        this.y = 0;
    }
});

const PresentationOutputs = new Lang.Class({
    Name: 'PresentationOutputs',

    _init: function() {
        this.list = [];

        let gdkscreen = Gdk.Screen.get_default();
        this._screen = GnomeDesktop.RRScreen.new(gdkscreen, null);
        this._screen.connect('changed', Lang.bind(this, this._onScreenChanged));

        this.load();
    },

    _onScreenChanged: function() {
        this.load();
    },

    load: function() {
        this._outputs = this._screen.list_outputs();
        this.list = [];
        for (let idx in this._outputs) {
            let output = this._outputs[idx];

            let out = new PresentationOutput();
            out.name = output.get_name();
            out.display_name = output.get_display_name();
            out.is_primary = output.get_is_primary();
            let [x, y] = output.get_position();
            out.x = x;
            out.y = y;

            this.list.push(out);
        }
    }
});
