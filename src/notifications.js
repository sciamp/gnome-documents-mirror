/*
 * Copyright (c) 2012 Red Hat, Inc.
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

const Clutter = imports.gi.Clutter;
const Gd = imports.gi.Gd;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const TrackerMiner = imports.gi.TrackerMiner;
const _ = imports.gettext.gettext;

const Application = imports.application;
const Utils = imports.utils;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const PrintNotification = new Lang.Class({
    Name: 'PrintNotification',

    _init: function(printOp, doc) {
        this.widget = null;
        this._printOp = printOp;
        this._doc = doc;

        this._printOp.connect('begin-print',
                              Lang.bind(this, this._onPrintBegin));
        this._printOp.connect('status-changed',
                              Lang.bind(this, this._onPrintStatus));
    },

    _onPrintBegin: function() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                     row_spacing: 6,
                                     margin_left: 12,
                                     margin_right: 12});

        this._statusLabel = new Gtk.Label();
        this.widget.add(this._statusLabel);
        this._progressBar = new Gtk.ProgressBar();
        this.widget.add(this._progressBar);

        this._stopButton = new Gtk.Button({ child: new Gtk.Image({ icon_name: 'process-stop-symbolic',
                                                                   pixel_size: 16,
                                                                   margin_top: 2,
                                                                   margin_bottom: 2 }),
                                            margin_left: 12,
                                            valign: Gtk.Align.CENTER
                                            });
        this.widget.attach_next_to(this._stopButton, this._statusLabel,
                                   Gtk.PositionType.RIGHT, 1, 2);
        this._stopButton.connect('clicked', Lang.bind(this,
            function() {
                this._printOp.cancel();
                this.widget.destroy();
            }));

        Application.notificationManager.addNotification(this);
    },

    _onPrintStatus: function() {
        if (!this.widget)
            return;

        let status = this._printOp.get_status();
        let fraction = this._printOp.get_progress();
	let name = this._printOp.get_job_name();
	status = _("Printing \"%s\": %s").format(this._doc.name, status);

        this._statusLabel.set_text(status);
        this._progressBar.fraction = fraction;

        if (fraction == 1)
            this.widget.destroy();
    }
});

const REMOTE_MINER_TIMEOUT = 10; // seconds
const TRACKER_MINER_FILES_NAME = 'org.freedesktop.Tracker1.Miner.Files';

const IndexingNotification = new Lang.Class({
    Name: 'IndexingNotification',

    _init: function() {
        this._closed = false;
        this._timeoutId = 0;

        try {
            this._manager = TrackerMiner.MinerManager.new_full(false);
            this._manager.connect('miner-progress', Lang.bind(this, this._checkNotification));
        } catch(e) {
            log('Unable to create a TrackerMinerManager, indexing progress ' +
                'notification won\'t work: ' + e.message);
            return;
        }

        Application.application.connectJS('miners-changed', Lang.bind(this, this._checkNotification));
        Mainloop.idle_add(Lang.bind(this,
            function() {
                this._checkNotification();
                return false;
            }));
    },

    _checkNotification: function() {
        let isIndexingLocal = false;
        let isIndexingRemote = false;

        if (this._manager) {
            let running = this._manager.get_running();
            if (running.indexOf(TRACKER_MINER_FILES_NAME) != -1) {
                let [res, status, progress, time] = this._manager.get_status(TRACKER_MINER_FILES_NAME);

                if (progress < 1)
                    isIndexingLocal = true;
            }
        }

        if (Application.application.minersRunning.length > 0)
            isIndexingRemote = true;

        if (isIndexingLocal) {
            this._display(_("Your documents are being indexed"),
                          _("Some documents might not be available during this process"));
        } else if (isIndexingRemote) {
            this._removeTimeout();
            this._timeoutId = Mainloop.timeout_add_seconds(REMOTE_MINER_TIMEOUT, Lang.bind(this, this._onTimeoutExpired));
        } else {
            this._destroy(false);
        }
    },

    _onTimeoutExpired: function() {
        this._timeoutId = 0;

        let primary = null;

        if (Application.application.minersRunning.length == 1) {
            let miner = Application.application.minersRunning[0];
            primary = _("Fetching documents from %s").format(miner.DisplayName);
        } else {
            primary = _("Fetching documents from online accounts");
        }

        this._display(primary, null);

        return false;
    },

    _removeTimeout: function() {
        if (this._timeoutId != 0) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    },

    _buildWidget: function() {
        this.widget = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                     margin_left: 12,
                                     margin_right: 12,
                                     column_spacing: 12 });

        let spinner = new Gtk.Spinner({ width_request: 16,
                                        height_request: 16 });
        spinner.start();
        this.widget.add(spinner);

        let labels = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                    row_spacing: 3 });
        this.widget.add(labels);

        this._primaryLabel = new Gtk.Label({ halign: Gtk.Align.START });
        labels.add(this._primaryLabel);

        this._secondaryLabel = new Gtk.Label({ halign: Gtk.Align.START });
        this._secondaryLabel.get_style_context().add_class('dim-label');
        labels.add(this._secondaryLabel);

        let close = new Gtk.Button({ child: new Gtk.Image({ icon_name: 'window-close-symbolic',
                                                            pixel_size: 16,
                                                            margin_top: 2,
                                                            margin_bottom: 2 }),
                                     valign: Gtk.Align.CENTER });
        close.connect('clicked', Lang.bind(this,
            function() {
                this._destroy(true);
            }));
        this.widget.add(close);

        Application.notificationManager.addNotification(this);
    },

    _update: function(primaryText, secondaryText) {
        this._primaryLabel.label = primaryText;
        this._secondaryLabel.label = secondaryText;

        if (secondaryText) {
            this._primaryLabel.vexpand = false;
            this._secondaryLabel.show();
        } else {
            this._primaryLabel.vexpand = true;
            this._secondaryLabel.hide();
        }
    },

    _display: function(primaryText, secondaryText) {
        if (this._closed) {
            return;
        }

        if (!this.widget)
            this._buildWidget();

        this._update(primaryText, secondaryText);
    },

    _destroy: function(closed) {
        this._removeTimeout();

        if (this.widget) {
            this.widget.destroy();
            this.widget = null;
        }

        this._closed = closed;
    }
});

const NotificationManager = new Lang.Class({
    Name: 'NotificationManager',

    _init: function() {
        this.widget = new Gd.Notification({ timeout: -1,
                                            show_close_button: false });
        this._grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                    row_spacing: 6 });

        this.actor = new GtkClutter.Actor({ contents: this.widget,
                                            x_align: Clutter.ActorAlign.CENTER,
                                            y_align: Clutter.ActorAlign.START,
                                            y_expand: true,
                                            visible: false });
        Utils.alphaGtkWidget(this.actor.get_widget());

        this.widget.add(this._grid);
        this.widget.show_all();

        // add indexing monitor notification
        this._indexingNotification = new IndexingNotification();
    },

    addNotification: function(notification) {
        this._grid.add(notification.widget);

        notification.widget.show_all();
        notification.widget.connect('destroy', Lang.bind(this, this._onWidgetDestroy));

        this.actor.show();
    },

    _onWidgetDestroy: function() {
        let children = this._grid.get_children();

        if (children.length == 0)
            this.actor.hide();
    }
});
Signals.addSignalMethods(NotificationManager.prototype);
