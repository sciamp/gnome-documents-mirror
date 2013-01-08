/*
 * Copyright(c) 2012 Meg Ford
 * Except for Line 530: 
 * JavaScript function to check an email address conforms to RFC822 (http://www.ietf.org/rfc/rfc0822.txt)
 *
 * Version: 0.2
 * Author: Ross Kendall
 * Created: 2006-12-16
 * Updated: 2007-03-22
 *
 * Based on the PHP code by Cal Henderson
 * http://iamcal.com/publish/articles/php/parsing_email/
 * Portions copyright (C) 2006  Ross Kendall - http://rosskendall.com
 * Portions copyright (C) 1993-2005 Cal Henderson - http://iamcal.com
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
 * Author: Meg Ford <megford@gnome.org>
 *
 */

const Clutter = imports.gi.Clutter;
const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const GData = imports.gi.GData;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const GtkClutter = imports.gi.GtkClutter;
const _ = imports.gettext.gettext;

const Application = imports.application;
const Documents = imports.documents;
const Manager = imports.manager;
const Query = imports.query;
const Selections = imports.selections;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;
const View = imports.view;

const Lang = imports.lang;
const Signals = imports.signals;

const SharingDialogColumns = {
    NAME: 0,
    ROLE: 1
};

const SharingDialog = new Lang.Class({
    Name: 'SharingDialog',

    _init: function() {             
        let urn = Application.selectionController.getSelection();
        let doc = Application.documentManager.getItemById(urn);
        this.identifier = doc.identifier;
        this.resourceUrn = doc.resourceUrn;
        let accountName = "";
        let allowChanges = false;
        let docPrivate = "";
        let entry = null;
        let errorStr ="";
        let feed = null;      
        let newPub = false;
        let noPermissionText = "";
        this.pubEdit = false;
        let rows = 0;
        let isVisible = true;
        this.changeEdit = false;

        this._createGDataEntry();
        let toplevel = Application.application.get_windows()[0];

        this.widget = new Gtk.Dialog({ resizable: false,
                                       transient_for: toplevel,
                                       modal: true,
                                       destroy_with_parent: true,
                                       width_request: 335,
                                       height_request: 200,
                                       margin_top: 5,
                                       title: _("Sharing Settings"),
                                       hexpand: true });
        this.widget.add_button(_("Done"), Gtk.ResponseType.OK);  // Label for Done button in Sharing dialog

        this.grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                   column_spacing: 6,
                                   row_spacing: 6,
                                   margin_left: 12,
                                   margin_right: 12,
                                   margin_bottom: 12 });
      	let contentArea = this.widget.get_content_area();
        contentArea.pack_start(this.grid, true, true, 0);
        
        this._spinner = new Gtk.Spinner ({ active: true, 
                                           halign: Gtk.Align.CENTER });
        this._spinner.set_size_request(86, 86);
        this._swSpinner = new Gtk.ScrolledWindow({ shadow_type: Gtk.ShadowType.IN,
                                                   margin_bottom: 3,
                                                   hexpand: true }); 
        this._swSpinner.set_size_request(-1, 250);
        this._swSpinner.add_with_viewport(this._spinner);
        this.grid.attach(this._swSpinner, 0, 0, 3, 1);

        this.sw = new Gtk.ScrolledWindow({ shadow_type: Gtk.ShadowType.IN,
                                           margin_bottom: 3,
                                           hexpand: true });
        
        this.sw.set_size_request(-1, 250);
        rows++;

        this.model = Gtk.ListStore.new(
            [ GObject.TYPE_STRING,
              GObject.TYPE_STRING ]);

        this.tree = new Gtk.TreeView({ headers_visible: false,
                                       vexpand: true,
                                       hexpand: true });
        this.tree.set_model(this.model);
        this.tree.show();
        this.sw.add(this.tree);

        this._viewCol = new Gtk.TreeViewColumn();
        this.tree.append_column(this._viewCol);

        // Name column
        this._rendererText = new Gtk.CellRendererText({ xpad: 6,
                                                        ypad: 4 });
        this._viewCol.pack_start(this._rendererText, true);
        this._viewCol.add_attribute(this._rendererText,
                                    'text', SharingDialogColumns.NAME);       
        
        // Role column
        this._rendererDetail = new Gd.StyledTextRenderer({ xpad: 16 });
        this._rendererDetail.add_class('dim-label');
        this._viewCol.pack_start(this._rendererDetail, false);
        this._viewCol.add_attribute(this._rendererDetail,
                                    'text', SharingDialogColumns.ROLE);

        this._docSharing = new Gtk.Label ({ label: '<b>' + _("Document permissions") + '</b>', 
                                            // Label for widget group for changing document permissions
                                            halign: Gtk.Align.START,
                                            use_markup: true,
                                            hexpand: false });
        this._docSharing.get_style_context().add_class('dim-label');
        this.grid.add(this._docSharing);
        rows++;
        
        this.dw = new Gtk.ButtonBox({ orientation: Gtk.Orientation.HORIZONTAL,
                                      margin_bottom: 3,
                                      hexpand: false });
        this.dw.set_layout(Gtk.ButtonBoxStyle.EDGE);
        this.dw.set_spacing(6);
        this.docPrivate = docPrivate;
        this._permissionLabel = this.docPrivate;
        this._setting = new Gtk.Label({ label: _(this._permissionLabel),
                                        halign: Gtk.Align.START,
                                        hexpand: false });
        this.dw.add(this._setting);

        this._changePermission = new Gtk.Button({ label: _("Change"), 
                                                  // Label for permission change in Sharing dialog
                                                  sensitive: false,
                                                  halign: Gtk.Align.END });
        this._changePermission.connect("clicked", Lang.bind(this, function() {
                                                               this._permissionPopUp()
							    }));
        this.dw.pack_start(this._changePermission, false, 0, 6);
        this.grid.attach(this.dw, 0, rows, 3, 1);
        rows++; 

        this.dpb = new Gtk.ButtonBox({ orientation: Gtk.Orientation.HORIZONTAL,
                                       hexpand: true });
        this.dpb.set_layout(Gtk.ButtonBoxStyle.END);
        this.dpb.set_spacing(0);
        
        this.button1 = new Gtk.RadioButton({ label:  _("Private") }); 
                                             // Label for radiobutton that sets doc permission to private
        this.button1.connect('clicked', Lang.bind (this, this._setDoc));
        this.grid.add(this.button1);
        rows++;

        this.button2 =  new Gtk.RadioButton({ group: this.button1, 
                                              label: _("Public") });
                                              // Label for radiobutton that sets doc permission to Public    
        this.button2.connect('clicked', Lang.bind (this, this._setDoc));
        this.grid.add(this.button2);
        rows++;
        
        this._check = new Gtk.CheckButton({ label: _("Can edit"),
                                            // Label for checkbutton that sets doc permission to Can edit 
                                            sensitive: false,
                                            margin_left: 25 });

        this._setButtons();

        this.grid.add(this._check);

        this._close = new Gtk.Button({ label: _("Save"),
                                       margin_left: 50 });  // Label for Save button for document permissions 
        this._close.connect('clicked', Lang.bind(this,
            function() {
                this._close.set_sensitive(false);             
                this._sendNewDocumentRule();
            }));

        this.grid.attach(this._close, 1, rows, 2, 1);
        rows++;

        this._add = new Gtk.Label ({ label: '<b>' +  _("Add people") + '</b>', // Label for widget group used for adding new contacts
                                     halign: Gtk.Align.START,
                                     use_markup: true,
                                     hexpand: false });
        this._add.get_style_context().add_class('dim-label');
        this.grid.attach(this._add, 0, rows, 1, 1);
        rows++;

        this._addContact = new Gtk.Entry({ placeholder_text: _("Enter an email address"), // Editable text in entry field
                                           editable: true,
                                           hexpand: true,
                                           halign: Gtk.Align.START });
        this._addContact.connect('changed', Lang.bind(this,
            function() {
                let hasText = !!this._isValidEmail();
                this._saveShare.sensitive = hasText;
                this._comboBoxText.sensitive = hasText;
            }));
        this.grid.add(this._addContact);

        this._comboBoxText = new Gtk.ComboBoxText({ sensitive: false });
        let combo = [_("Can edit"), _("Can view") ]; // Permission setting labels in combobox
        for (let i = 0; i < combo.length; i++)
            this._comboBoxText.append_text(combo[i]);

        this._comboBoxText.set_active(0);
        this.grid.attach_next_to(this._comboBoxText, this._addContact, 1, 1, 1);

        this._saveShare = new Gtk.Button({ label: _("Add"),
                                           sensitive: false });
        this._saveShare.connect ('clicked', Lang.bind(this, this._onAddClicked));
        this.grid.attach_next_to(this._saveShare, this._comboBoxText, 1, 1, 1);

        this.noPermissionText = noPermissionText;
        this._noPermissionLabel = this.noPermissionText;       
        this._noPermission = new Gtk.Label({ label: _(this._noPermissionLabel),
                                             halign: Gtk.Align.START,
                                             hexpand: true });
        this.grid.attach(this._noPermission, 0, rows, 3, 1);
       
        this.widget.show_all();
        this.isVisible = isVisible;
        this._docPermissionButtons(this.isVisible);
        this._addContact.hide();
        this._comboBoxText.hide();
        this._saveShare.hide();
    },

    _permissionPopUp: function() { 
        this.isVisible = false;
        this._docPermissionButtons(this.isVisible);
    },
    
    _permissionPopUpDestroy: function() {
        if (this.changeEdit == false) {
        if (this.button1.get_active())
            this.docPrivate = "Private";
        else
            this.docPrivate = "Public";
        } else {
           this.docPrivate = "";
        }
        this._setting.set_text(this.docPrivate);
        this.isVisible = true;
        this._docPermissionButtons(this.isVisible);
        this._close.set_sensitive(true);//what does this do?
    },

    _docPermissionButtons: function(isVisible) {
        this.isVisible = isVisible;

        if (this.isVisible) {
            this.dw.show();
            this.button1.hide();
            this.button2.hide();
            this._check.hide();
            this._close.hide();
        }
        
        else {
            this.dw.hide();
            this.button1.show();
            this.button2.show();
            this._check.show();
            this._close.show();  
            if (this.docPrivate == "Public")
                this.button2.set_active(true);
            else if (this.docPrivate == "Private")
                this.button1.set_active(true);            
            this._setDoc();          
        }
    },

    // Get the id of the selected doc from the sourceManager, give auth info to Google, and start the service
    _createGDataEntry: function() {
        let source = Application.sourceManager.getItemById(this.resourceUrn);

        let authorizer = new GData.GoaAuthorizer({ goa_object: source.object });
        let service = new GData.DocumentsService({ authorizer: authorizer });
        // Query the service for the entry related to the doc
        service.query_single_entry_async(service.get_primary_authorization_domain(),
            this.identifier, null, GData.DocumentsText, null, Lang.bind(this,
                function(object, res) {
                    try {
                        this.entry = object.query_single_entry_finish(res);
                        this._getGDataEntryRules(this.entry, service);
                    } catch (e) {
                        log("Error getting GData Entry " + e.message);
                    }
                }));
    },

    // Return a feed containing the acl related to the entry
    _getGDataEntryRules: function(entry, service) {
        this.entry.get_rules_async(service, null, null, Lang.bind(this,
            function(entry, result) {
                try {
                    this.feed = service.query_finish(result);
                    this._getScopeRulesEntry(this.feed);
	        } catch(e) {
                    log("Error getting ACL Feed " + e.message);
	        }
            }));
    },

    // Get each entry (person) from the feed, and get the scope for each person, and then store the emails and values in an array
    _getScopeRulesEntry: function(feed) {
        let entries = this.feed.get_entries();
        let testValues = [];
        let values = [];
        this._getAccountName();
        
        entries.forEach(Lang.bind(this,
            function(entry) {
                let [type, value] = entry.get_scope();
                let role = entry.get_role();

                if (value != null) {
                    values.push({ name: value, role: this._getUserRoleString(role) });

                    if ((this.accountName == value) && (role == 'writer' || role == 'owner'))
                        this.allowChanges = true;                  
                } else if (value == null) {
                    if (role != 'none')
                        this.docPrivate = "Public"; // Text for document permission label
                    this._setting.set_text(this.docPrivate); 

                    if (role == 'writer') {
                        this.pubEdit = true;
                    } 
                }

                if(role == 'owner')
                   this.noPermissionText = value; 
             }));

        // Set values in the treemodel
        if (this.changeEdit == false) {
        values.forEach(Lang.bind (this,
            function(value) {
                 let iter = this.model.append();
                 this.model.set(iter,
                     [ SharingDialogColumns.NAME,
                       SharingDialogColumns.ROLE ],
                     [ value.name, value.role ])
            }));
         }

        this.grid.attach(this.sw, 0, 0, 3, 1);
        this.sw.set_visible(false);
        this._swSpinner.destroy();
        this.sw.set_visible(true);

        if (this.docPrivate == "")
            this.docPrivate = "Private"; // Text for document permission label
        this._setting.set_text(this.docPrivate);  

        if(this.allowChanges) { 
            this._changePermission.set_sensitive(true);
            this._noPermission.hide();
            this._addContact.show();
            this._comboBoxText.show();
            this._saveShare.show();
        } else {
            this._noPermission.set_text("You can ask " + 
                                        this.noPermissionText + " for access");
        }

    },

    // Get the roles, and make a new array containing strings that start with capital letters
    _getUserRoleString: function(role) {
        if (role.charAt(0) == 'o')
            return _("Owner"); // Owner permission for document user listed in treeview

        if (role.charAt(0) == 'w')
            return _("Can edit"); // Writer permission for document user listed in treeview

        if (role.charAt(0) == 'r')
            return _("Can view"); // Reader permission for document user listed in treeview

        return '';
    },

    // Send the new contact and its permissions to Google Docs
    _onAddClicked: function() {
        let source = Application.sourceManager.getItemById(this.resourceUrn);

        let authorizer = new GData.GoaAuthorizer({ goa_object: source.object });
        let service = new GData.DocumentsService({ authorizer: authorizer });
        let accessRule = new GData.AccessRule();

        let newContact = this._getNewContact();
        accessRule.set_role(newContact.role);
        accessRule.set_scope(GData.ACCESS_SCOPE_USER, newContact.name);

        let aclLink = this.entry.look_up_link(GData.LINK_ACCESS_CONTROL_LIST);

        service.insert_entry_async(service.get_primary_authorization_domain(),
            aclLink.get_uri(), accessRule, null, Lang.bind(this,
                function(service, res) {
                    try {
                        let insertedAccessRule = service.insert_entry_finish(res);
                        let roleString = this._getUserRoleString(newContact.role);
                        let iter = this.model.append();

                        this.model.set(iter,
                        [ SharingDialogColumns.NAME,
                        SharingDialogColumns.ROLE ],
                        [ newContact.name,
                        roleString]);

                        this._addContact.set_text("");
                        this._addContact.set_placeholder_text("Enter an email address"); // Editable text in entry field      
                    } catch(e) {
                        log("Error inserting new ACL rule " + e.message);
                        this.errorStr = "The document was not updated";
                        this._showErrorDialog(this.errorStr);
		    }
                }));
    },

    _sendNewDocumentRule: function() {
        let source = Application.sourceManager.getItemById(this.resourceUrn);

        let authorizer = new GData.GoaAuthorizer({ goa_object: source.object });
        let service = new GData.DocumentsService({ authorizer: authorizer });

        let docAccessRule = this._getDocumentPermission();
        let newDocRole = this._getDocumentRole();
        let entries = this.feed.get_entries();
        let values = [];
        let count = 0;
        let arrIndex = 0;
        let flag = "";
        this.changeEdit = true;

        entries.forEach(Lang.bind(this,
            function(individualEntry) {
                let [type, value] = individualEntry.get_scope();
                let role = individualEntry.get_role();

                if (type == "default") {
                    arrIndex = count;
                    
                    if (docAccessRule == GData.ACCESS_SCOPE_USER)
                        flag = "deletePub";
                    else if (newDocRole != role && role != "none")
                        flag = "changePub";
                    else if (role == "none")
                        flag = "deleteLinkToPub";
                    else 
                        flag = "doNotSend";                           
                }
                count++;  
            }));

        if (flag == "" && docAccessRule == GData.ACCESS_SCOPE_DEFAULT)
            flag = "addPub";
 
        if (flag != "") {
      
            if (flag == "addPub") { 
            // If we are making the doc public, send a new permission
                let accessRule = new GData.AccessRule();
                let aclLink = this.entry.look_up_link(GData.LINK_ACCESS_CONTROL_LIST);

                accessRule.set_scope(docAccessRule, null);
                accessRule.set_role(newDocRole);
                service.insert_entry_async(service.get_primary_authorization_domain(),
                    aclLink.get_uri(), accessRule, null, Lang.bind(this,
                        function(service, res) {
                            try {
                                let insertedAccessRule = service.insert_entry_finish(res);
                                this._createGDataEntry();
                               // this._setButtons();
                            } catch(e) {
                                log("Error inserting new ACL scope for document " + e.message);
                                this.errorStr = "The document was not updated";
                                this._showErrorDialog(this.errorStr);
		            } 
                this._permissionPopUpDestroy();                          
                        }));               
            }
             
            if (flag == "changePub") { 
            // If we are changing the role, update the entry              
                let accessRule = entries[arrIndex];

                accessRule.set_role(newDocRole);
                service.update_entry_async(service.get_primary_authorization_domain(), 
                    accessRule, null, Lang.bind(this,
                        function(service, res) {
                            try {
                                let updatedAccessRule = service.update_entry_finish(res); 
                                this._createGDataEntry();
                               // this._setButtons();
                            } catch(e) {
                                log("Error updating ACL scope for document " + e.message);
                                this.errorStr = "The document was not updated";
                                this._showErrorDialog(this.errorStr);
		            }
                 this._permissionPopUpDestroy();
                        }));
            }
                      
            if (flag == "deletePub") { 
            // If we are changing the permission to private, delete the public entry.
                let accessRule = entries[arrIndex];

                service.delete_entry_async(service.get_primary_authorization_domain(), 
                    accessRule, null, Lang.bind(this,
                        function(service, res) {
                            try {
                                let afterDeletedAccessRule = service.delete_entry_finish(res);
                                this._createGDataEntry();
                            } catch(e) {
                                log("Error deleting ACL scope for document  " + e.message);
                                this.errorStr = "The document was not updated";
                                this._showErrorDialog(this.errorStr);
		            }
                                this._permissionPopUpDestroy();
                        }));
            }

            if ( flag == "deleteLinkToPub") { 
            // Workaround if the doc is shared with link: step 1 delete shared with link permission.
                let accessRule = entries[arrIndex];

                service.delete_entry_async(service.get_primary_authorization_domain(), 
                    accessRule, null, Lang.bind(this,
                        function(service, res) {
                            try {
                                let afterDeletedAccessRule = service.delete_entry_finish(res);
                            } catch(e) {
                                log("Error deleting ACL scope for document  " + e.message);
                                this.errorStr = "The document was not updated";
                                this._showErrorDialog(this.errorStr);
		            }
                        }));
            }
                
            if (flag == "deleteLinkToPub") {
            // Workaround if the doc is shared with link: step 2 add the new public permisssion.
                let newAccessRule = new GData.AccessRule();
                let aclLink = this.entry.look_up_link(GData.LINK_ACCESS_CONTROL_LIST);

                newAccessRule.set_scope(docAccessRule, null);
                newAccessRule.set_role(newDocRole);
                service.insert_entry_async(service.get_primary_authorization_domain(),
                    aclLink.get_uri(), newAccessRule, null, Lang.bind(this,
                        function(service, res) {
                            try {
                                let insertedAccessRule = service.insert_entry_finish(res);
                                this._createGDataEntry();
                            } catch(e) {
                                log("Error inserting new ACL scope for document " + e.message);
                                this.errorStr = "The document was not updated";
                                this._showErrorDialog(this.errorStr);
		            } 
                this._permissionPopUpDestroy();                           
                        }));
            }

            if (flag == "doNotSend") {
                this.changeEdit = false;
                this._permissionPopUpDestroy();
            } 
        } else {
            this.changeEdit = false;
            this._permissionPopUpDestroy();
        }  
    },

    // Get the role for the new contact from the combobox
    _getNewContact: function() {
        let activeItem = this._comboBoxText.get_active();
        let newContact = { name: this._addContact.get_text() };

        if (activeItem == 0)
            newContact.role = GData.DOCUMENTS_ACCESS_ROLE_WRITER;
        else if (activeItem == 1)
            newContact.role = GData.DOCUMENTS_ACCESS_ROLE_READER;

        return newContact;
    },

    // Get the scope from the radiobuttons
    _getDocumentPermission: function() {
        let docAccRule = null; 
     
        if (this.button1.get_active()) {
        	this.docAccRule = GData.ACCESS_SCOPE_USER;
        } else if (this.button2.get_active()) {
        	this.docAccRule = GData.ACCESS_SCOPE_DEFAULT;   
        }

        return this.docAccRule;              
    },

    // Get the role from the checkbox
    _getDocumentRole: function() {
        let newDocRole = null;

        if (this._check.get_active()) 
            this.newDocRole = GData.DOCUMENTS_ACCESS_ROLE_WRITER;                           
        else
            this.newDocRole = GData.DOCUMENTS_ACCESS_ROLE_READER;

        return this.newDocRole;
    },

    // Set the checkbox to the sensitive if the public radiobutton is active
    _setDoc: function() { 
 
        if (this.button2.get_active()) {
            this._check.set_sensitive(true);
        } else {
            this._check.set_active(false);
            this._check.set_sensitive(false);
        }   
    },

    _setButtons: function() {

        if (this.pubEdit == false) {
            this._check.set_active(false);
        } else {
            this._check.set_active(true);
        }
    
        if (this.docPrivate == "Public" ) {
            this.button2.set_active(true);
            this._check.set_sensitive(true);
        }
    },
    
    _isValidEmail: function() { 
        let emailString = this._addContact.get_text();
        // Use Ross Kendell's RegEx to check for valid email address
        return /^([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x22([^\x0d\x22\x5c\x80-\xff]|\x5c[\x00-\x7f])*\x22))*\x40([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d)(\x2e([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x3c\x3e\x40\x5b-\x5d\x7f-\xff]+|\x5b([^\x0d\x5b-\x5d\x80-\xff]|\x5c[\x00-\x7f])*\x5d))*$/.test(emailString);
    },

    _getAccountName: function() {
        // Get the email address for the goa account from dbus
        let client = Application.goaClient.new_sync(null);
        let accounts = client.get_accounts();
        
        accounts.forEach(Lang.bind(this,
            function(object) {
                if (object.get_account()) {
                    let accountInfo = object.get_account();
                    /* Since object.get_account() returns the Goa.AccountProxy, 
                    use the .operator to access the Dbus interface's elements */
                    let accountType = accountInfo.provider_name;
                    if(accountType == "Google") // Check that we are getting the identity from the correct account
                        this.accountName = accountInfo.identity;
                    else
                        this.accountName = "noMatch";  
                }
            }));  
    },

    _showErrorDialog: function(errorStr) {
        let msg = this.errorStr;
        this._errorDialog = new Gtk.MessageDialog ({ transient_for: this.widget,
                                                     modal: true,
                                                     destroy_with_parent: true,
                                                     buttons: Gtk.ButtonsType.OK,
                                                     message_type: Gtk.MessageType.WARNING,
                                                     text: msg }); 

        this._errorDialog.connect ('response', Lang.bind(this, this._closeErrorDialog));
        this._errorDialog.show();
    },
    
    _closeErrorDialog: function() {
        this._errorDialog.destroy();
    }
});

