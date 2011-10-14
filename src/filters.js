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

const Signals = imports.signals;

function SearchFilterController() {
    this._init();
};

SearchFilterController.prototype = {
    _init: function() {
        this._filter = '';
    },

    setFilter: function(filter) {
        if (this._filter == filter)
            return;

        this._filter = filter;
        this.emit('changed', this._filter);
    },

    getFilter: function() {
        return this._filter;
    }
};
Signals.addSignalMethods(SearchFilterController.prototype);

function SideFilterController() {
    this._init();
}

SideFilterController.prototype = {
    _init: function() {
        this._whereItem = null;
    },

    setActiveItem: function(controller, item) {
        if (this._whereItem == item)
            return;

        this._whereItem = item;
        controller.setActiveItem(this._whereItem);

        this.emit('changed', this._whereItem);
    },

    getWhere: function() {
        if (!this._whereItem)
            return '';

        return this._whereItem.getWhere();
    },

    getWhereItem: function() {
        return this._whereItem;
    }
};
Signals.addSignalMethods(SideFilterController.prototype);