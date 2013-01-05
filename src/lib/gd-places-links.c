/* -*- Mode: C; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 8;  -*-
 *
 *  Copyright (C) 2004 Red Hat, Inc.
 *  Copyright (C) 2013 Red Hat, Inc.
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2, or (at your option)
 *  any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */

#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include <string.h>

#include <glib/gi18n.h>
#include <gtk/gtk.h>

#include <evince-document.h>
#include <evince-view.h>

#include "gd-places-links.h"
#include "gd-places-page.h"

struct _GdPlacesLinksPrivate {
        GtkWidget *tree_view;

        guint selection_id;
        guint page_changed_id;
        guint link_activated_id;

        EvJob *job;
        GtkTreeModel *model;
        EvDocument *document;
        EvDocumentModel *document_model;
};

enum {
        LINK_ACTIVATED,
        N_SIGNALS
};

static guint signals[N_SIGNALS];

static void gd_places_links_page_iface_init (GdPlacesPageInterface *iface);

G_DEFINE_TYPE_EXTENDED (GdPlacesLinks,
                        gd_places_links,
                        GTK_TYPE_BOX,
                        0,
                        G_IMPLEMENT_INTERFACE (GD_TYPE_PLACES_PAGE,
                                               gd_places_links_page_iface_init))


#define GD_PLACES_LINKS_GET_PRIVATE(object) \
        (G_TYPE_INSTANCE_GET_PRIVATE ((object), GD_TYPE_PLACES_LINKS, GdPlacesLinksPrivate))

static gboolean
emit_link_activated (GdPlacesLinks *self)
{
        GtkTreeSelection *selection;
        GtkTreeModel *model;
        GtkTreeIter iter;

        selection = gtk_tree_view_get_selection (GTK_TREE_VIEW (self->priv->tree_view));

        if (gtk_tree_selection_get_selected (selection, &model, &iter)) {
                EvLink *link;
                EvDocumentModel *document_model;

                gtk_tree_model_get (model, &iter,
                                    EV_DOCUMENT_LINKS_COLUMN_LINK, &link,
                                    -1);

                if (link == NULL) {
                        return;
                }


                document_model = g_object_ref (self->priv->document_model);
                if (self->priv->page_changed_id > 0) {
                        g_signal_handler_block (document_model,
                                                self->priv->page_changed_id);
                }
                g_signal_emit (self, signals[LINK_ACTIVATED], 0, link);
                if (self->priv->page_changed_id > 0) {
                        g_signal_handler_unblock (document_model,
                                                  self->priv->page_changed_id);
                }
                g_object_unref (document_model);

                g_object_unref (link);
        }

        self->priv->link_activated_id = 0;

        return FALSE;
}

static void
selection_changed_cb (GtkTreeSelection *selection,
                      GdPlacesLinks    *self)
{
        g_return_if_fail (self->priv->document != NULL);

        /* jump through some hoops to avoid destroying in the middle
           of a button press handler */
        if (self->priv->link_activated_id == 0) {
                self->priv->link_activated_id = g_idle_add ((GSourceFunc)emit_link_activated, self);
        }
}

static gboolean
update_page_cb_foreach (GtkTreeModel  *model,
                        GtkTreePath   *path,
                        GtkTreeIter   *iter,
                        GdPlacesLinks *self)
{
        EvLink *link;
        int current_page;
        int dest_page;
        EvDocumentLinks *document_links;

        gtk_tree_model_get (model, iter,
                            EV_DOCUMENT_LINKS_COLUMN_LINK, &link,
                            -1);
        if (link == NULL) {
                return FALSE;
        }

        document_links = EV_DOCUMENT_LINKS (self->priv->document);

        dest_page = ev_document_links_get_link_page (document_links, link);
        g_object_unref (link);

        current_page = ev_document_model_get_page (self->priv->document_model);

        if (dest_page == current_page) {
                gtk_tree_view_expand_to_path (GTK_TREE_VIEW (self->priv->tree_view),
                                              path);
                gtk_tree_view_set_cursor (GTK_TREE_VIEW (self->priv->tree_view),
                                          path, NULL, FALSE);

                return TRUE;
        }

        return FALSE;
}

static void
gd_places_links_set_current_page (GdPlacesLinks *self,
                                  int            current_page)
{
        GtkTreeSelection *selection;
        GtkTreeModel *model;
        GtkTreeIter iter;

        selection = gtk_tree_view_get_selection (GTK_TREE_VIEW (self->priv->tree_view));

        if (gtk_tree_selection_get_selected (selection, &model, &iter)) {
                EvLink *link;

                gtk_tree_model_get (model, &iter,
                                    EV_DOCUMENT_LINKS_COLUMN_LINK, &link,
                                    -1);
                if (link != NULL) {
                        int dest_page;
                        EvDocumentLinks *document_links = EV_DOCUMENT_LINKS (self->priv->document);

                        dest_page = ev_document_links_get_link_page (document_links, link);
                        g_object_unref (link);

                        if (dest_page == current_page) {
                                return;
                        }
                }
        }

        /* We go through the tree linearly looking for the first page that
         * matches.  This is pretty inefficient.  We can do something neat with
         * a GtkTreeModelSort here to make it faster, if it turns out to be
         * slow.
         */
        g_signal_handler_block (selection, self->priv->selection_id);

        gtk_tree_model_foreach (model,
                                (GtkTreeModelForeachFunc)update_page_cb_foreach,
                                self);

        g_signal_handler_unblock (selection, self->priv->selection_id);
}

static void
update_page_cb (GdPlacesLinks *self,
                int            old_page,
                int            new_page)
{
        gd_places_links_set_current_page (self, new_page);
}

static void
job_finished_cb (EvJobLinks     *job,
                 GdPlacesLinks *self)
{
        GdPlacesLinksPrivate *priv = self->priv;
        GtkTreeSelection *selection;

        g_clear_object (&priv->model);
        priv->model = g_object_ref (job->model);

        gtk_tree_view_set_model (GTK_TREE_VIEW (priv->tree_view), job->model);

        g_clear_object (&priv->job);

        selection = gtk_tree_view_get_selection (GTK_TREE_VIEW (priv->tree_view));
        gtk_tree_selection_set_mode (selection, GTK_SELECTION_SINGLE);

        gtk_tree_view_expand_all (GTK_TREE_VIEW (priv->tree_view));

        if (priv->selection_id <= 0) {
                priv->selection_id =
                        g_signal_connect (selection, "changed",
                                          G_CALLBACK (selection_changed_cb),
                                          self);
        }

        if (priv->page_changed_id <= 0) {
                priv->page_changed_id =
                        g_signal_connect_swapped (priv->document_model, "page-changed",
                                                  G_CALLBACK (update_page_cb),
                                                  self);
        }

        gd_places_links_set_current_page (self,
                                          ev_document_model_get_page (priv->document_model));
}

static GtkTreeModel *
create_loading_model (void)
{
        GtkTreeModel *retval;
        GtkTreeIter iter;

        /* Creates a fake model to indicate that we're loading */
        retval = (GtkTreeModel *)gtk_list_store_new (EV_DOCUMENT_LINKS_COLUMN_NUM_COLUMNS,
                                                     G_TYPE_STRING,
                                                     G_TYPE_OBJECT,
                                                     G_TYPE_BOOLEAN,
                                                     G_TYPE_STRING);

        gtk_list_store_append (GTK_LIST_STORE (retval), &iter);
        gtk_list_store_set (GTK_LIST_STORE (retval), &iter,
                            EV_DOCUMENT_LINKS_COLUMN_MARKUP, _("Loading…"),
                            EV_DOCUMENT_LINKS_COLUMN_EXPAND, FALSE,
                            EV_DOCUMENT_LINKS_COLUMN_LINK, NULL,
                            -1);

        return retval;
}

static void
gd_places_links_construct (GdPlacesLinks *self)
{
        GdPlacesLinksPrivate *priv;
        GtkWidget *swindow;
        GtkTreeViewColumn *column;
        GtkCellRenderer *renderer;
        GtkTreeSelection *selection;

        priv = self->priv;

        swindow = gtk_scrolled_window_new (NULL, NULL);

        gtk_scrolled_window_set_shadow_type (GTK_SCROLLED_WINDOW (swindow),
                                             GTK_SHADOW_IN);

        /* Create tree view */
        priv->tree_view = gtk_tree_view_new ();

        gtk_tree_view_set_show_expanders (GTK_TREE_VIEW (priv->tree_view), FALSE);
        gtk_tree_view_set_level_indentation (GTK_TREE_VIEW (priv->tree_view), 20);

        selection = gtk_tree_view_get_selection (GTK_TREE_VIEW (priv->tree_view));
        gtk_tree_selection_set_mode (selection, GTK_SELECTION_NONE);
        gtk_tree_view_set_headers_visible (GTK_TREE_VIEW (priv->tree_view), FALSE);
        gtk_container_add (GTK_CONTAINER (swindow), priv->tree_view);

        gtk_box_pack_start (GTK_BOX (self), swindow, TRUE, TRUE, 0);
        gtk_widget_show_all (GTK_WIDGET (self));

        column = gtk_tree_view_column_new ();
        gtk_tree_view_column_set_expand (GTK_TREE_VIEW_COLUMN (column), TRUE);
        gtk_tree_view_append_column (GTK_TREE_VIEW (priv->tree_view), column);

        renderer = (GtkCellRenderer *)
                g_object_new (GTK_TYPE_CELL_RENDERER_TEXT,
                              "ellipsize", PANGO_ELLIPSIZE_END,
                              "weight", PANGO_WEIGHT_BOLD,
                              "xpad", 10,
                              NULL);
        gtk_tree_view_column_pack_start (GTK_TREE_VIEW_COLUMN (column), renderer, TRUE);
        gtk_tree_view_column_set_attributes (GTK_TREE_VIEW_COLUMN (column), renderer,
                                             "markup", EV_DOCUMENT_LINKS_COLUMN_MARKUP,
                                             NULL);

        renderer = (GtkCellRenderer *)
                g_object_new (GTK_TYPE_CELL_RENDERER_TEXT,
                              "ellipsize", PANGO_ELLIPSIZE_MIDDLE,
                              "foreground", "#cccccc",
                              "max-width-chars", 12,
                              "scale", PANGO_SCALE_SMALL,
                              "xalign", 1.0,
                              "xpad", 10,
                              NULL);
        gtk_tree_view_column_pack_end (GTK_TREE_VIEW_COLUMN (column), renderer, FALSE);
        gtk_tree_view_column_set_attributes (GTK_TREE_VIEW_COLUMN (column), renderer,
                                             "text", EV_DOCUMENT_LINKS_COLUMN_PAGE_LABEL,
                                             NULL);
}

static GtkTreeModel *
create_failed_model (void)
{
        GtkTreeModel *retval;
        GtkTreeIter iter;

        /* Creates a fake model to indicate there is no contents */
        retval = (GtkTreeModel *)gtk_list_store_new (EV_DOCUMENT_LINKS_COLUMN_NUM_COLUMNS,
                                                     G_TYPE_STRING,
                                                     G_TYPE_OBJECT,
                                                     G_TYPE_BOOLEAN,
                                                     G_TYPE_STRING);

        gtk_list_store_append (GTK_LIST_STORE (retval), &iter);
        gtk_list_store_set (GTK_LIST_STORE (retval), &iter,
                            EV_DOCUMENT_LINKS_COLUMN_MARKUP, _("No table of contents"),
                            EV_DOCUMENT_LINKS_COLUMN_EXPAND, FALSE,
                            EV_DOCUMENT_LINKS_COLUMN_LINK, NULL,
                            -1);

        return retval;
}

static void
gd_places_links_document_changed_cb (EvDocumentModel *model,
                                     GParamSpec      *pspec,
                                     GdPlacesLinks   *self)
{
        EvDocument *document = ev_document_model_get_document (model);
        GdPlacesLinksPrivate *priv = self->priv;

        if (!EV_IS_DOCUMENT_LINKS (document)) {
                return;
        }

        g_clear_object (&priv->document);
        priv->document = g_object_ref (document);

        if (priv->job != NULL) {
                ev_job_cancel (self->priv->job);
                g_clear_object (&priv->job);
        }

        if (!gd_places_page_supports_document (GD_PLACES_PAGE (self), document)) {
                GtkTreeModel *failed_model;

                failed_model = create_failed_model ();
                gtk_tree_view_set_model (GTK_TREE_VIEW (priv->tree_view), failed_model);
                g_object_unref (failed_model);
        } else {
                GtkTreeModel *loading_model;

                loading_model = create_loading_model ();
                gtk_tree_view_set_model (GTK_TREE_VIEW (priv->tree_view), loading_model);
                g_object_unref (loading_model);

                priv->job = ev_job_links_new (document);
                g_signal_connect (priv->job,
                                  "finished",
                                  G_CALLBACK (job_finished_cb),
                                  self);

                /* The priority doesn't matter for this job */
                ev_job_scheduler_push_job (priv->job, EV_JOB_PRIORITY_NONE);
        }
}

static gboolean
gd_places_links_supports_document (GdPlacesPage *places_page,
                                   EvDocument   *document)
{
        return (EV_IS_DOCUMENT_LINKS (document) &&
                ev_document_links_has_document_links (EV_DOCUMENT_LINKS (document)));
}

static const char *
gd_places_links_get_label (GdPlacesPage *places_page)
{
        return _("Contents");
}

static const char *
gd_places_links_get_icon_name (GdPlacesPage *places_page)
{
        return "view-list-symbolic";
}

static void
gd_places_links_set_document_model (GdPlacesPage    *places_page,
                                    EvDocumentModel *model)
{
        GdPlacesLinks *self = GD_PLACES_LINKS (places_page);
        GdPlacesLinksPrivate *priv = self->priv;

        if (priv->document_model == model) {
                return;
        }

        if (priv->page_changed_id > 0) {
                g_signal_handler_disconnect (priv->document_model, priv->page_changed_id);
                priv->page_changed_id = 0;
        }

        if (priv->document_model != NULL) {
                g_signal_handlers_disconnect_by_func (priv->document_model,
                                                      gd_places_links_document_changed_cb,
                                                      places_page);
        }

        g_clear_object (&priv->document_model);

        priv->document_model = model;

        if (priv->document_model != NULL) {
                g_object_ref (priv->document_model);
                g_signal_connect (priv->document_model,
                                  "notify::document",
                                  G_CALLBACK (gd_places_links_document_changed_cb),
                                  places_page);
                gd_places_links_document_changed_cb (priv->document_model,
                                                     NULL,
                                                     self);
        }
}

static void
gd_places_links_dispose (GObject *object)
{
        GdPlacesLinks *self = GD_PLACES_LINKS (object);

        if (self->priv->link_activated_id > 0) {
                g_source_remove (self->priv->link_activated_id);
                self->priv->link_activated_id = 0;
        }

        if (self->priv->job != NULL) {
                ev_job_cancel (self->priv->job);
                g_clear_object (&self->priv->job);
        }

        if (self->priv->page_changed_id > 0) {
                g_signal_handler_disconnect (self->priv->document_model, self->priv->page_changed_id);
                self->priv->page_changed_id = 0;
        }

        g_clear_object (&self->priv->model);
        g_clear_object (&self->priv->document);
        g_clear_object (&self->priv->document_model);

        G_OBJECT_CLASS (gd_places_links_parent_class)->dispose (object);
}


static void
gd_places_links_init (GdPlacesLinks *self)
{
        self->priv = GD_PLACES_LINKS_GET_PRIVATE (self);

        gd_places_links_construct (self);
}

static void
gd_places_links_page_iface_init (GdPlacesPageInterface *iface)
{
        iface->supports_document = gd_places_links_supports_document;
        iface->set_document_model = gd_places_links_set_document_model;
        iface->get_label = gd_places_links_get_label;
}

static void
gd_places_links_class_init (GdPlacesLinksClass *klass)
{
        GObjectClass *oclass = G_OBJECT_CLASS (klass);

        oclass->dispose = gd_places_links_dispose;

        signals[LINK_ACTIVATED] = g_signal_new ("link-activated",
                                                G_TYPE_FROM_CLASS (oclass),
                                                G_SIGNAL_RUN_LAST | G_SIGNAL_ACTION,
                                                0,
                                                NULL, NULL,
                                                g_cclosure_marshal_VOID__OBJECT,
                                                G_TYPE_NONE, 1, G_TYPE_OBJECT);

        g_type_class_add_private (oclass, sizeof (GdPlacesLinksPrivate));
}

GtkWidget *
gd_places_links_new (void)
{
        return g_object_new (GD_TYPE_PLACES_LINKS, NULL);
}
