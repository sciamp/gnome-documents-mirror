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
const Gd = imports.gi.Gd;

const EvDocument = imports.gi.EvinceDocument;
const GdPrivate = imports.gi.GdPrivate;
const Application = imports.application;
const Documents = imports.documents;
const Mainloop = imports.mainloop;
const MainToolbar = imports.mainToolbar;

const Lang = imports.lang;

const PlacesDialog = new Lang.Class({
    Name: 'PlacesDialog',

    _init: function(model, bookmarks) {
        this._model = model;
        this._bookmarks = bookmarks;
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

        this._header = new Gtk.HeaderBar();
        this.widget.set_titlebar(this._header);

        let button = new Gd.HeaderSimpleButton({ label: _("Close") });
        this._header.pack_end(button);
        button.connect('clicked', Lang.bind(this,
            function() {
                this.widget.response(Gtk.ResponseType.CLOSE);
            }));

        let contentArea = this.widget.get_content_area();
        this._stack = new Gtk.Stack({ border_width: 5,
                                      homogeneous: true });
        contentArea.pack_start(this._stack, true, true, 0);

        let switcher = new Gtk.StackSwitcher({ stack: this._stack });
        this._header.set_custom_title(switcher);

        this._linksPage = new GdPrivate.PlacesLinks();
        this._linksPage.connect('link-activated', Lang.bind(this,
            function(widget, link) {
                this._handleLink(link);
            }));
        this._addPage(this._linksPage);

        this._bookmarksPage = new GdPrivate.PlacesBookmarks({ bookmarks: this._bookmarks });
        this._bookmarksPage.connect('bookmark-activated', Lang.bind(this,
            function(widget, link) {
                this._handleBookmark(link);
            }));
        this._addPage(this._bookmarksPage);
    },

    _handleLink: function(link) {
        if (link.action.type == EvDocument.LinkActionType.GOTO_DEST) {
            this._gotoDest(link.action.dest);
        }
        this.widget.response(Gtk.ResponseType.CLOSE);
    },

    _handleBookmark: function(bookmark) {
        this._model.set_page(bookmark.page_number);
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
        widget.document_model = this._model;
        this._stack.add(widget);
        this._stack.child_set_property(widget, 'title', widget.name);
    }
});
