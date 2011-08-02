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
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;

function PreviewView(model, document) {
    this._init(model, document);
}

PreviewView.prototype = {
    _init: function(model, document) {
        this._model = model;
        this._document = document;

        this.widget = EvView.View.new();
        this.widget.set_model(this._model);
        this.widget.show();
    },

    destroy: function() {
        this.widget.destroy();
    }
};