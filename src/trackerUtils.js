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

const GLib = imports.gi.GLib;
const Lang = imports.lang;

const Application = imports.application;

function setEditedName(newTitle, docId, callback) {
    let sparql = ('INSERT OR REPLACE { <%s> nie:title \"%s\" }'.format(docId, newTitle));

    Application.connectionQueue.update(sparql, null,
        function(object, res) {
            try {
                object.update_finish(res);
            } catch (e) {
                log('Unable to set the new title on ' + docId + ' to : ' + e.toString());
            }

            if (callback)
                callback();
        });

}

const SingleItemJob = new Lang.Class({
    Name: 'SingleItemJob',

    _init: function(urn, queryBuilder) {
        this._urn = urn;
        this._cursor = null;
        this._builder = queryBuilder;
    },

    run: function(flags, callback) {
        this._callback = callback;

        let query = this._builder.buildSingleQuery(flags, this._urn);
        Application.connectionQueue.add(query.sparql, null, Lang.bind(this,
            function(object, res) {
                try {
                    let cursor = object.query_finish(res);
                    cursor.next_async(null, Lang.bind(this, this._onCursorNext));
                } catch (e) {
                    log('Unable to query single item ' + e.message);
                    this._emitCallback();
                }
            }));
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            log('Unable to query single item ' + e.message);
        }

        if (!valid) {
            cursor.close();
            this._emitCallback();

            return;
        }

        this._cursor = cursor;
        this._emitCallback();
        cursor.close();
    },

    _emitCallback: function() {
        this._callback(this._cursor);
    }
});
