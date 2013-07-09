SUBDIRS = icons

desktopdir = $(datadir)/applications
desktop_DATA = $(desktop_in_files:.desktop.in=.desktop)
desktop_in_files = gnome-documents.desktop.in

searchproviderdir = $(datadir)/gnome-shell/search-providers
searchprovider_DATA = gnome-documents-search-provider.ini

@INTLTOOL_DESKTOP_RULE@

check-local: gnome-documents.desktop
	$(DESKTOP_FILE_VALIDATE) gnome-documents.desktop

gsettings_ENUM_NAMESPACE = org.gnome.Documents
gsettings_ENUM_FILES = \
    $(top_srcdir)/libgd/libgd/gd-main-view.h

gsettingsschema_in_files = org.gnome.documents.gschema.xml.in
gsettings_SCHEMAS = $(gsettingsschema_in_files:.xml.in=.xml)
.PRECIOUS: $(gsettings_SCHEMAS)

@INTLTOOL_XML_NOMERGE_RULE@
@GSETTINGS_RULES@

EXTRA_DIST= \
    gnome-documents.desktop \
    $(desktop_in_files) \
    $(searchprovider_DATA) \
    $(gsettingsschema_in_files)

CLEANFILES = \
    $(desktop_DATA) \
    $(gsettings_SCHEMAS)
