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

const WebKit = imports.gi.WebKit;
const Soup = imports.gi.Soup;
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
const MainToolbar = imports.mainToolbar;
const Searchbar = imports.searchbar;
const Utils = imports.utils;
const View = imports.view;
const WindowMode = imports.windowMode;
const Documents = imports.documents;

const _BLANK_URI = "about:blank";

const EditView = new Lang.Class({
    Name: 'EditView',

    _init: function() {
        this._uri = null;

        this.widget = new Gtk.Overlay();

        this._scrolledWindow = new Gtk.ScrolledWindow({ hexpand: true,
                                                        vexpand: true,
                                                        shadow_type: Gtk.ShadowType.IN });
        this.widget.get_style_context().add_class('documents-scrolledwin');
        this.widget.add(this._scrolledWindow);

        this._session = WebKit.get_default_session ();
        Soup.Session.prototype.add_feature.call(this._session, new Soup.ProxyResolverDefault());
        Soup.Session.prototype.remove_feature.call(this._session, new Soup.CookieJar());
        let jarfile = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-documents', 'cookies.sqlite'])
        this._cookieJar = new Soup.CookieJarDB({ filename: jarfile, read_only: false });
        Soup.Session.prototype.add_feature.call(this._session, this._cookieJar);

        this._progressBar = new Gtk.ProgressBar({ halign: Gtk.Align.FILL,
                                                  valign: Gtk.Align.START });
        this._progressBar.get_style_context().add_class('osd');
        this.widget.add_overlay(this._progressBar);

        this._createView();

        this.widget.show_all();

        this._editAction = Application.application.lookup_action('edit-current');
        this._editAction.enabled = false;
        this._editAction.connect('activate', Lang.bind(this,
            function() {
                let doc = Application.documentManager.getActiveItem();
                if (!doc)
                    return;
                Application.modeController.setWindowMode(WindowMode.WindowMode.EDIT);
                this.setUri (doc.uri);
            }));

        this._viewAction = Application.application.lookup_action('view-current');
        this._viewAction.enabled = false;
        this._viewAction.connect('activate', Lang.bind(this,
            function() {
                Application.modeController.setWindowMode(WindowMode.WindowMode.PREVIEW);
            }));

        Application.documentManager.connect('load-started',
                                            Lang.bind(this, this._onLoadStarted));
        Application.documentManager.connect('load-finished',
                                            Lang.bind(this, this._onLoadFinished));

    },

    _onLoadStarted: function() {
        this._editAction.enabled = false;
        this._viewAction.enabled = false;
    },

    _onLoadFinished: function(manager, doc, docModel) {
        if (doc.uri) {
            if (doc instanceof Documents.GoogleDocument)
                this._editAction.enabled = true;
            this._viewAction.enabled = true;
        }
    },

    _createView: function() {
        this.view = new WebKit.WebView();
        this._scrolledWindow.add(this.view);
        this.view.show();
        this.view.connect('notify::progress', Lang.bind(this, this._onProgressChanged));
    },

    _isLoading: function() {
        let status = this.view.load_status;
        if ((status == WebKit.LoadStatus.finished
            || status == WebKit.LoadStatus.failed)
            && status != WebKit.LoadStatus.provisional)
            return false;

        return status != WebKit.LoadStatus.finished
            && status != WebKit.LoadStatus.failed;
    },

    _onProgressChanged: function() {
        if (!this.view.uri || this.view.uri == _BLANK_URI)
            return;

        let progress = this.view.progress;
        let loading = this._isLoading();

        if (progress == 1.0 || !loading) {
            if (!this._timeoutId)
                this._timeoutId = Mainloop.timeout_add(500, Lang.bind(this, this._onTimeoutExpired));
        } else {
            if (this._timeoutId) {
                Mainloop.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
            this._progressBar.show();
        }
        let value = 0.0
        if (loading || progress == 1.0)
            value = progress;
        this._progressBar.fraction = value;
    },

    _onTimeoutExpired: function() {
        this._timeoutId = 0;
        this._progressBar.hide();
        return false;
    },

    setUri: function(uri) {
        if (this._uri == uri)
            return;

        if (!uri)
            uri = _BLANK_URI;

        this._uri = uri;
        this.view.load_uri (uri);
    },

    getUri: function() {
        return this._uri;
    },
});
Signals.addSignalMethods(EditView.prototype);

const EditToolbar = new Lang.Class({
    Name: 'EditToolbar',
    Extends: MainToolbar.MainToolbar,

    _init: function(editView) {
        this._editView = editView;

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

        let viewButton =
            this.widget.add_button(null, _("View"), false);
        viewButton.get_style_context().add_class('suggested-action');
        viewButton.set_action_name('app.view-current');

        this._setToolbarTitle();
        this.widget.show_all();
    },

    createSearchbar: function() {
    },

    handleEvent: function(event) {
        return false;
    },

    _setToolbarTitle: function() {
        let primary = null;
        let doc = Application.documentManager.getActiveItem();

        if (doc)
            primary = doc.name;

        this.widget.set_labels(primary, null);
    }
});
