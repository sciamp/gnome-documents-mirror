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

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const EvDocument = imports.gi.EvinceDocument;
const GdPrivate = imports.gi.GdPrivate;
const Application = imports.application;
const Documents = imports.documents;
const Mainloop = imports.mainloop;

const Lang = imports.lang;

const PlacesDialog = new Lang.Class({
    Name: 'PlacesDialog',

    _init: function(model) {
        this._model = model;
        this._createWindow();
        this.widget.show_all();
    },

    _createWindow: function() {
        let toplevel = Application.application.get_windows()[0];
        this.widget = new Gtk.Dialog ({ resizable: true,
                                        transient_for: toplevel,
                                        modal: true,
                                        destroy_with_parent: true,
                                        default_width: 600, // FIXME use toplevel size
                                        default_height: 600,
                                        title: "",
                                        hexpand: true });
        this.widget.add_button(Gtk.STOCK_CLOSE, Gtk.ResponseType.CLOSE);

        this._notebook = new Gtk.Notebook ({ show_tabs: false,
                                             border_width: 5 });

        this._linksPage = new GdPrivate.PlacesLinks ();
        this._linksPage.connect('link-activated', Lang.bind(this,
            function(widget, link) {
                this._handleLink(link);
            }));

        this._addPage(this._linksPage);

        let contentArea = this.widget.get_content_area();
        contentArea.pack_start(this._notebook, true, true, 0);
    },

    _handleLink: function(link) {
        if (link.action.type == EvDocument.LinkActionType.GOTO_DEST) {
            this._gotoDest(link.action.dest);
        }
        this.widget.response(Gtk.ResponseType.CLOSE);
    },

    _gotoDest: function(dest) {
        switch (dest.type) {
        case EvDocument.LinkDestType.PAGE:
        case EvDocument.LinkDestType.XYZ:
            this._model.set_page(dest.page);
            break;
        case EvDocument.LinkDestType.NAMED:
            let doc = this._model.get_document();
            let dest2 = doc.find_link_dest(dest.named);
            if (dest2)
                this._gotoDest(dest2);
            break;
        case EvDocument.LinkDestType.PAGE_LABEL:
            this._model.set_page_by_label(dest.page_label);
            break;
        }
    },

    _addPage: function(widget) {
        let label = new Gtk.Label({ label: widget.get_label() });
        widget.set_document_model(this._model);
        this._notebook.append_page(widget, label);
    }

});
