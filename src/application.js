/*
 * Copyright (c) 2011, 2012 Red Hat, Inc.
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
const Signals = imports.signals;
const Gettext = imports.gettext;
const _ = imports.gettext.gettext;

// Import versions go here
imports.gi.versions.GdPrivate = '1.0';
imports.gi.versions.Gd = '1.0';
imports.gi.versions.Tracker = '0.16';
imports.gi.versions.TrackerMiner = '0.16';
imports.gi.versions.EvinceDocument = '3.0';
imports.gi.versions.Goa = '1.0';

const EvDoc = imports.gi.EvinceDocument;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Goa = imports.gi.Goa;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Tracker = imports.gi.Tracker;
const TrackerMiner = imports.gi.TrackerMiner;

const ChangeMonitor = imports.changeMonitor;
const Documents = imports.documents;
const Format = imports.format;
const Main = imports.main;
const MainWindow = imports.mainWindow;
const MainToolbar = imports.mainToolbar;
const Manager = imports.manager;
const Miners = imports.miners;
const Notifications = imports.notifications;
const Path = imports.path;
const Properties = imports.properties;
const Query = imports.query;
const Search = imports.search;
const Selections = imports.selections;
const ShellSearchProvider = imports.shellSearchProvider;
const TrackerController = imports.trackerController;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;
const WindowMode = imports.windowMode;

// used globally
let application = null;
let connection = null;
let connectionQueue = null;
let goaClient = null;
let settings = null;

// used by the application, but not by the search provider
let changeMonitor = null;
let collectionManager = null;
let documentManager = null;
let modeController = null;
let notificationManager = null;
let offsetController = null;
let queryBuilder = null;
let searchCategoryManager = null;
let searchController = null;
let searchMatchManager = null;
let searchTypeManager = null;
let selectionController = null;
let sourceManager = null;
let trackerController = null;

const MINER_REFRESH_TIMEOUT = 60; /* seconds */

const Application = new Lang.Class({
    Name: 'Application',
    Extends: Gtk.Application,

    _init: function() {
        this.minersRunning = [];
        this._activationTimestamp = Gdk.CURRENT_TIME;

        Gettext.bindtextdomain('gnome-documents', Path.LOCALE_DIR);
        Gettext.textdomain('gnome-documents');
        GLib.set_prgname('gnome-documents');
        GLib.set_application_name(_("Documents"));

        this.parent({ application_id: 'org.gnome.Documents',
                      flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
                      inactivity_timeout: 12000 });
    },

    _initGettingStarted: function() {
        let manager = TrackerMiner.MinerManager.new_full(false);

        let languages = GLib.get_language_names();
        let files = languages.map(
            function(language) {
                return Gio.File.new_for_path(Path.RESOURCE_DIR + '/getting-started/' + language +
                    '/gnome-documents-getting-started.pdf');
            });

        this.gettingStartedLocation = null;

        function checkNextFile(obj) {
            let file = files.shift();
            if (!file) {
                log('Can\'t find a valid getting started PDF document');
                return;
            }

            file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, 0, null, Lang.bind(this,
                function(object, res) {
                    try {
                        let info = object.query_info_finish(res);
                        this.gettingStartedLocation = file.get_parent();

                        GdPrivate.tracker_miner_manager_index_file_async(manager, file,
                            function(object, res) {
                                try {
                                    GdPrivate.tracker_miner_manager_index_file_finish(object, res);
                                } catch (e) {
                                    log('Error indexing the getting started PDF: ' + e.message);
                                }
                            });
                    } catch (e) {
                        checkNextFile.apply(this);
                    }
                }));
        }

        checkNextFile.apply(this);
    },

    _fullscreenCreateHook: function(action) {
        modeController.connect('can-fullscreen-changed', Lang.bind(this,
            function() {
                let canFullscreen = modeController.getCanFullscreen();
                action.set_enabled(canFullscreen);
            }));
    },

    _viewAsCreateHook: function(action) {
        settings.connect('changed::view-as', Lang.bind(this,
            function() {
                action.state = settings.get_value('view-as');
            }));
    },

    _onActionQuit: function() {
        this._mainWindow.window.destroy();
    },

    _onActionAbout: function() {
        this._mainWindow.showAbout();
    },

    _onActionHelp: function() {
        try {
            Gtk.show_uri(this._mainWindow.window.get_screen(),
                         'help:gnome-help/documents',
                         Gtk.get_current_event_time());
        } catch (e) {
            log('Unable to display help: ' + e.message);
        }
    },

    _onActionFullscreen: function() {
        modeController.toggleFullscreen();
    },

    _onActionViewAs: function(action, parameter) {
        settings.set_value('view-as', parameter);
    },

    _onActionOpenCurrent: function() {
        let doc = documentManager.getActiveItem();
        if (doc)
            doc.open(this._mainWindow.window.get_screen(), Gtk.get_current_event_time());
    },

    _onActionPrintCurrent: function() {
        let doc = documentManager.getActiveItem();
        if (doc)
            doc.print(this._mainWindow.window);
    },

    _onActionToggle: function(action) {
        let state = action.get_state();
        action.change_state(GLib.Variant.new('b', !state.get_boolean()));
    },

    _onActionProperties: function() {
        let doc = documentManager.getActiveItem();
        if (!doc)
            return;

        let dialog = new Properties.PropertiesDialog(doc.id);
        dialog.widget.connect('response', Lang.bind(this,
            function(widget, response) {
                widget.destroy();
            }));
    },

    _initActions: function() {
        this._actionEntries.forEach(Lang.bind(this,
            function(actionEntry) {
                let state = actionEntry.state;
                let parameterType = actionEntry.parameter_type ?
                    GLib.VariantType.new(actionEntry.parameter_type) : null;
                let action;

                if (state)
                    action = Gio.SimpleAction.new_stateful(actionEntry.name,
                        parameterType, actionEntry.state);
                else
                    action = new Gio.SimpleAction({ name: actionEntry.name });

                if (actionEntry.create_hook)
                    actionEntry.create_hook.apply(this, [action]);

                if (actionEntry.callback)
                    action.connect('activate', Lang.bind(this, actionEntry.callback));

                if (actionEntry.accel)
                    this.add_accelerator(actionEntry.accel, 'app.' + actionEntry.name, null);

                this.add_action(action);
            }));
    },

    _connectActionsToMode: function() {
        this._actionEntries.forEach(Lang.bind(this,
            function(actionEntry) {
                if (actionEntry.window_mode) {
                    modeController.connect('window-mode-changed', Lang.bind(this,
                        function() {
                            let mode = modeController.getWindowMode();
                            let action = this.lookup_action(actionEntry.name);
                            action.set_enabled(mode == actionEntry.window_mode);
                        }));
                }
            }));
    },

    _initAppMenu: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/documents/app-menu.ui');

        let menu = builder.get_object('app-menu');
        this.set_app_menu(menu);
    },

    _refreshMinerNow: function(miner) {
        let env = GLib.getenv('DOCUMENTS_DISABLE_MINERS');
        if (env)
            return false;

        this.minersRunning.push(miner);
        this.emitJS('miners-changed', this.minersRunning);

        miner._cancellable = new Gio.Cancellable();
        miner.RefreshDBRemote(miner._cancellable, Lang.bind(this,
            function(res, error) {
                this.minersRunning = this.minersRunning.filter(
                    function(element) {
                        return element != miner;
                    });
                this.emitJS('miners-changed', this.minersRunning);

                if (error) {
                    log('Error updating the cache: ' + error.toString());
                    return;
                }

                Mainloop.timeout_add_seconds(MINER_REFRESH_TIMEOUT,
                                             Lang.bind(this, function() {
                                                 this._refreshMinerNow(miner);
                                             }));
            }));

        return false;
    },

    _refreshMiners: function() {
        if (sourceManager.hasProviderType('google')) {
            try {
                // startup a refresh of the gdocs cache
                this._refreshMinerNow(this.gdataMiner);
            } catch (e) {
                log('Unable to start GData miner: ' + e.message);
            }
        }

        if (sourceManager.hasProviderType('windows_live')) {
            try {
                // startup a refresh of the skydrive cache
                this._refreshMinerNow(this.zpjMiner);
            } catch (e) {
                log('Unable to start Zpj miner: ' + e.message);
            }
        }
    },

    _startMiners: function() {
        this._refreshMiners();

        this._sourceAddedId = sourceManager.connect('item-added', Lang.bind(this, this._refreshMiners));
        this._sourceRemovedId = sourceManager.connect('item-removed', Lang.bind(this, this._refreshMiners));
    },

    _stopMiners: function() {
        if (this._sourceAddedId != 0) {
            sourceManager.disconnect(this._sourceAddedId);
            this._sourceAddedId = 0;
        }

        if (this._sourceRemovedId != 0) {
            sourceManager.disconnect(this._sourceRemovedId);
            this._sourceRemovedId = 0;
        }

        this.minersRunning.forEach(Lang.bind(this,
            function(miner) {
                miner._cancellable.cancel();
            }));
    },

    vfunc_startup: function() {
        this.parent();
        String.prototype.format = Format.format;

        Gtk.init(null);
        EvDoc.init();

        let resource = Gio.Resource.load(Path.RESOURCE_DIR + '/gnome-documents.gresource');
        resource._register();

        application = this;
        settings = new Gio.Settings({ schema: 'org.gnome.documents' });

        // connect to tracker
        try {
            connection = Tracker.SparqlConnection.get(null);
        } catch (e) {
            log('Unable to connect to the tracker database: ' + e.toString());
            return;
        }

        try {
            goaClient = Goa.Client.new_sync(null);
        } catch (e) {
            log('Unable to create the GOA client: ' + e.toString());
            return;
        }

        connectionQueue = new TrackerController.TrackerConnectionQueue();
        this._searchProvider = new ShellSearchProvider.ShellSearchProvider();
        this._searchProvider.connect('activate-result', Lang.bind(this, this._onActivateResult));
        this._searchProvider.connect('launch-search', Lang.bind(this, this._onLaunchSearch));

        // now init application components
        Search.initSearch(imports.application);

        changeMonitor = new ChangeMonitor.TrackerChangeMonitor();
        documentManager = new Documents.DocumentManager();
        trackerController = new TrackerController.TrackerController();
        selectionController = new Selections.SelectionController();
        modeController = new WindowMode.ModeController();

        this._actionEntries = [
            { name: 'quit',
              callback: this._onActionQuit,
              accel: '<Primary>q' },
            { name: 'about',
              callback: this._onActionAbout },
            { name: 'help',
              callback: this._onActionHelp,
              accel: 'F1' },
            { name: 'fullscreen',
              callback: this._onActionFullscreen,
              create_hook: this._fullscreenCreateHook,
              accel: 'F11',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'gear-menu',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accel: 'F10',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'view-as',
              callback: this._onActionViewAs,
              create_hook: this._viewAsCreateHook,
              parameter_type: 's',
              state: settings.get_value('view-as'),
              window_mode: WindowMode.WindowMode.OVERVIEW },
            { name: 'open-current',
              callback: this._onActionOpenCurrent,
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'edit-current',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'view-current',
              window_mode: WindowMode.WindowMode.EDIT },
            { name: 'present-current',
              window_mode: WindowMode.WindowMode.PREVIEW,
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accel: 'F5'
            },
            { name: 'print-current', accel: '<Primary>p',
              callback: this._onActionPrintCurrent,
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'search',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accel: '<Primary>f' },
            { name: 'find-next', accel: '<Primary>g',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'find-prev', accel: '<Shift><Primary>g',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'zoom-in', accel: '<Primary>plus',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'zoom-in', accel: '<Primary>equal',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'zoom-out', accel: '<Primary>minus',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'rotate-left', accel: '<Primary>Left',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'rotate-right', accel: '<Primary>Right',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'select-all', accel: '<Primary>a',
              window_mode: WindowMode.WindowMode.OVERVIEW },
            { name: 'select-none',
              window_mode: WindowMode.WindowMode.OVERVIEW },
            { name: 'properties',
              callback: this._onActionProperties,
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'bookmark-page',
              callback: this._onActionToggle,
              state: GLib.Variant.new('b', false),
              accel: '<Primary>d',
              window_mode: WindowMode.WindowMode.PREVIEW },
            { name: 'places',
              accel: '<Primary>b',
              window_mode: WindowMode.WindowMode.PREVIEW }
        ];

        this.gdataMiner = new Miners.GDataMiner();
        this.zpjMiner = new Miners.ZpjMiner();

        this._initActions();
        this._initAppMenu();
        this._initGettingStarted();
    },

    _createWindow: function() {
        if (this._mainWindow)
            return;

        notificationManager = new Notifications.NotificationManager();
        this._connectActionsToMode();
        this._mainWindow = new MainWindow.MainWindow(this);
        this._mainWindow.window.connect('destroy', Lang.bind(this, this._onWindowDestroy));

        // start miners
        this._startMiners();
    },

    vfunc_activate: function() {
        if (this._mainWindow) {
            this._mainWindow.window.present_with_time(this._activationTimestamp);
            this._activationTimestamp = Gdk.CURRENT_TIME;
        }
    },

    vfunc_command_line: function(cmdline) {
        let args = cmdline.get_arguments();
        if (args.indexOf('--no-default-window') == -1)
            this._createWindow();

        modeController.setWindowMode(WindowMode.WindowMode.OVERVIEW);
        this.activate();
        return 0;
    },

    _clearState: function() {
        // clean up signals
        changeMonitor.disconnectAll();
        documentManager.disconnectAll();
        trackerController.disconnectAll();
        selectionController.disconnectAll();
        modeController.disconnectAll();

        // reset state
        documentManager.setActiveItem(null);
        modeController.setWindowMode(WindowMode.WindowMode.NONE);
        selectionController.setSelection(null);
        notificationManager = null;

        // stop miners
        this._stopMiners();
    },

    _onWindowDestroy: function(window) {
        this._mainWindow = null;

        // clear our state in an idle, so other handlers connected
        // to 'destroy' have the chance to perform their cleanups first
        Mainloop.idle_add(Lang.bind(this, this._clearState));
    },

    _onActivateResult: function(provider, urn, terms, timestamp) {
        this._createWindow();
        modeController.setWindowMode(WindowMode.WindowMode.PREVIEW);
        this._activationTimestamp = timestamp;
        this.activate();

        searchController.setString(terms.join(' '));

        let doc = documentManager.getItemById(urn);
        if (doc) {
            documentManager.setActiveItem(doc);
        } else {
            let job = new TrackerUtils.SingleItemJob(urn, queryBuilder);
            job.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                function(cursor) {
                    if (!cursor)
                        return;

                    let doc = documentManager.addDocumentFromCursor(cursor);
                    documentManager.setActiveItem(doc);
                }));
        }
    },

    _onLaunchSearch: function(provider, terms, timestamp) {
        this._createWindow();
        modeController.setWindowMode(WindowMode.WindowMode.OVERVIEW);
        searchController.setString(terms.join(' '));
        this.change_action_state('search', GLib.Variant.new('b', true));

        this._activationTimestamp = timestamp;
        this.activate();
    }
});
Utils.addJSSignalMethods(Application.prototype);
