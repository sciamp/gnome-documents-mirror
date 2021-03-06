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

const Gdk = imports.gi.Gdk;

const Lang = imports.lang;
const Signals = imports.signals;

const Application = imports.application;

const WindowMode = {
    NONE: 0,
    OVERVIEW: 1,
    PREVIEW: 2,
    EDIT: 3
};

const ModeController = new Lang.Class({
    Name: 'ModeController',

    _init: function() {
        this._mode = WindowMode.NONE;
        this._fullscreen = false;
        this._canFullscreen = false;
    },

    setWindowMode: function(mode) {
        let oldMode = this._mode;

        if (oldMode == mode)
            return;

        if (mode == WindowMode.PREVIEW
            || mode == WindowMode.EDIT) {
            this.setCanFullscreen(true);
        } else {
            this.setCanFullscreen(false);
        }

        this._mode = mode;

        this.emit('window-mode-changed', this._mode, oldMode);

        if (mode != WindowMode.PREVIEW)
            return;

        let window = Application.application.get_active_window();
        let gdkWindow = window.get_window();

        if (gdkWindow) {
            let windowState = gdkWindow.get_state();

            if (windowState & Gdk.WindowState.MAXIMIZED)
                this.setFullscreen(true);
        }
    },

    getWindowMode: function() {
        return this._mode;
    },

    setCanFullscreen: function(canFullscreen) {
        this._canFullscreen = canFullscreen;

        if (!this._canFullscreen && this._fullscreen)
            this.setFullscreen(false);

        this.emit('can-fullscreen-changed');
    },

    setFullscreen: function(fullscreen) {
        if (this._mode != WindowMode.PREVIEW
            && this._mode != WindowMode.EDIT)
            return;

        if (this._fullscreen == fullscreen)
            return;

        if (fullscreen && !this._canFullscreen)
            return;

        this._fullscreen = fullscreen;
        this.emit('fullscreen-changed', this._fullscreen);
    },

    toggleFullscreen: function() {
        this.setFullscreen(!this._fullscreen);
    },

    getFullscreen: function() {
        return this._fullscreen;
    },

    getCanFullscreen: function() {
        return this._canFullscreen;
    }
});
Signals.addSignalMethods(ModeController.prototype);
