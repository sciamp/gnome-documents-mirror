# Adapted from yelp-tools/tools/yelp.m4 and gtk-doc/gtk-doc.m4

AC_DEFUN([GETTING_STARTED_INIT],
[
AC_REQUIRE([AC_PROG_LN_S])
m4_pattern_allow([AM_V_at])
m4_pattern_allow([AM_V_GEN])
m4_pattern_allow([AM_DEFAULT_VERBOSITY])

AC_ARG_VAR([ITSTOOL], [Path to the `itstool` command])
AC_CHECK_PROG([ITSTOOL], [itstool], [itstool])
if test x"$ITSTOOL" = x; then
  AC_MSG_ERROR([itstool not found])
fi

AC_ARG_ENABLE([getting-started],
  AS_HELP_STRING([--enable-getting-started],
                 [build getting started PDFs [[default=no]]]),,
  [enable_getting_started=no])

AC_MSG_CHECKING([whether to build getting-started PDFs])
AC_MSG_RESULT($enable_getting_started)
AM_CONDITIONAL([ENABLE_GETTING_STARTED], [test x$enable_getting_started = xyes])

GETTING_STARTED_RULES='

HELP_DIR = $(pkgdatadir)/getting-started
HELP_FILES ?=
HELP_LINGUAS ?=

_HELP_LINGUAS = $(if $(filter environment,$(origin LINGUAS)),$(filter $(LINGUAS),$(HELP_LINGUAS)),$(HELP_LINGUAS))
_HELP_POFILES = $(foreach lc,$(_HELP_LINGUAS),$(lc)/$(lc).po)
_HELP_MOFILES = $(patsubst %.po,%.mo,$(_HELP_POFILES))
_HELP_PDFFILES = $(patsubst %.svg,%.pdf,$(HELP_FILES))
_HELP_C_FILES = $(foreach f,$(HELP_FILES),C/$(f))
_HELP_C_PDFS = $(patsubst %.svg,%.pdf,$(_HELP_C_FILES))
_HELP_LC_FILES = $(foreach lc,$(_HELP_LINGUAS),$(foreach f,$(HELP_FILES),$(lc)/$(f)))
_HELP_LC_STAMPS = $(foreach lc,$(_HELP_LINGUAS),$(lc)/$(lc).stamp)
_HELP_LC_PDFS = $(patsubst %.svg,%.pdf,$(_HELP_LC_FILES))

_HELP_OUTPUT = gnome-documents-getting-started.pdf
_HELP_PDF_OUTPUTS = $(foreach lc,C $(_HELP_LINGUAS),$(lc)/$(_HELP_OUTPUT))

_HELP_DEFAULT_V = $(if $(AM_DEFAULT_VERBOSITY),$(AM_DEFAULT_VERBOSITY),1)
_HELP_V = $(if $(V),$(V),$(_HELP_DEFAULT_V))
_HELP_LC_VERBOSE = $(_HELP_LC_VERBOSE_$(_HELP_V))
_HELP_LC_VERBOSE_ = $(_HELP_LC_VERBOSE_$(_HELP_DEFAULT_V))
_HELP_LC_VERBOSE_0 = @echo "  GEN    "$(dir [$]@);

all: $(_HELP_C_FILES) $(_HELP_LC_FILES) $(_HELP_POFILES) $(_HELP_C_PDFS) $(_HELP_LC_PDFS) $(_HELP_PDF_OUTPUTS)

$(_HELP_POFILES):
	$(AM_V_at)if ! test -d "$(dir [$]@)"; then mkdir "$(dir [$]@)"; fi
	$(AM_V_at)if test ! -f "[$]@" -a -f "$(srcdir)/[$]@"; then cp "$(srcdir)/[$]@" "[$]@"; fi
	$(AM_V_GEN)if ! test -f "[$]@"; then \
	  (cd "$(dir [$]@)" && \
	    $(ITSTOOL) -o "$(notdir [$]@).tmp" $(_HELP_C_FILES) && \
	    mv "$(notdir [$]@).tmp" "$(notdir [$]@)"); \
	else \
	  (cd "$(dir [$]@)" && \
	    $(ITSTOOL) -o "$(notdir [$]@).tmp" $(_HELP_C_FILES) && \
	    msgmerge -o "$(notdir [$]@)" "$(notdir [$]@)" "$(notdir [$]@).tmp" && \
	    rm "$(notdir [$]@).tmp"); \
	fi

$(_HELP_LC_PDFS): $(_HELP_LC_FILES)
	$(AM_V_at)if ! test -d "$(dir [$]@)"; then mkdir "$(dir [$]@)"; fi
	svgname=$(patsubst %.pdf,%.svg,[$]@); \
	inkscape -z -A "[$]@" "$$svgname"

$(_HELP_C_PDFS): $(_HELP_C_FILES)
	$(AM_V_at)if ! test -d "$(dir [$]@)"; then mkdir "$(dir [$]@)"; fi
	svgname=$(srcdir)/$(patsubst %.pdf,%.svg,[$]@); \
	inkscape -z -A "[$]@" "$$svgname"

$(_HELP_PDF_OUTPUTS): $(_HELP_LC_PDFS) $(_HELP_C_PDFS)
	lc=`dirname [$]@`; \
	files="$(foreach f,$(_HELP_PDFFILES),$$lc/$(f))"; \
	pdfunite $$files "$$lc/$(_HELP_OUTPUT)"; \
	rm -f $$files

$(_HELP_MOFILES): %.mo: %.po
	$(AM_V_at)if ! test -d "$(dir [$]@)"; then mkdir "$(dir [$]@)"; fi
	$(AM_V_GEN)msgfmt -o "[$]@" "$<"

$(_HELP_LC_FILES): $(_HELP_LINGUAS)
$(_HELP_LINGUAS): $(_HELP_LC_STAMPS)
$(_HELP_LC_STAMPS): %.stamp: %.mo
$(_HELP_LC_STAMPS): $(_HELP_C_FILES)
	$(AM_V_at)if ! test -d "$(dir [$]@)"; then mkdir "$(dir [$]@)"; fi
	$(_HELP_LC_VERBOSE)if test -d "C"; then d="../"; else d="$(abs_srcdir)/"; fi; \
	mo="$(dir [$]@)$(patsubst %/$(notdir [$]@),%,[$]@).mo"; \
	if test -f "$${mo}"; then mo="../$${mo}"; else mo="$(abs_srcdir)/$${mo}"; fi; \
	(cd "$(dir [$]@)" && $(ITSTOOL) -m "$${mo}" $(foreach f,$(_HELP_C_FILES),$${d}/$(f))) && \
	touch "[$]@"

.PHONY: clean-pdfs
mostlyclean-am: clean-pdfs
clean-pdfs:
	rm -f $(_HELP_LC_FILES) $(_HELP_LC_STAMPS) $(_HELP_MOFILES) $(_HELP_PDF_OUTPUTS)

EXTRA_DIST ?=
EXTRA_DIST += $(_HELP_POFILES) $(_HELP_C_FILES)

.PHONY: install-pdfs
install-data-am: install-pdfs
install-pdfs:
	@for lc in C $(_HELP_LINGUAS); do \
	  $(mkinstalldirs) "$(DESTDIR)$(HELP_DIR)/$$lc" || exit 1; \
	done
	@for lc in C $(_HELP_LINGUAS); do \
	  if test -f "$$lc/$(_HELP_OUTPUT)"; then d=; else d="$(srcdir)/"; fi; \
	  helpdir="$(DESTDIR)$(HELP_DIR)/$$lc/"; \
	  if ! test -d "$$helpdir"; then $(mkinstalldirs) "$$helpdir"; fi; \
	  echo "$(INSTALL_DATA) $$d$$lc/$(_HELP_OUTPUT) $$helpdir`basename $(_HELP_OUTPUT)`"; \
	  $(INSTALL_DATA) "$$d$$lc/$(_HELP_OUTPUT)" "$$helpdir`basename $(_HELP_OUTPUT)`" || exit 1; \
	done

.PHONY: uninstall-pdfs
uninstall-am: uninstall-pdfs
uninstall-pdfs:
	for lc in C $(_HELP_LINGUAS); do \
	  helpdir="$(DESTDIR)$(HELP_DIR)/$$lc/"; \
	  echo "rm -f $$helpdir`basename $(_HELP_OUTPUT)`"; \
	  rm -f "$$helpdir`basename $(_HELP_OUTPUT)`"; \
	done
'
AC_SUBST([GETTING_STARTED_RULES])
m4_ifdef([_AM_SUBST_NOTMAKE], [_AM_SUBST_NOTMAKE([GETTING_STARTED_RULES])])
])
