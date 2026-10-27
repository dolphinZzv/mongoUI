package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/config"
)

// errReadOnly is returned when a write is attempted on a read-only connection.
var errReadOnly = errors.New("connection is read-only; write operations are disabled")

// errReadOnlyAccount is returned when a read-only account attempts a write.
var errReadOnlyAccount = errors.New("read-only account; write operations are disabled")

// ensureWritable rejects writes for connections flagged read-only, so the flag
// is enforced by the server rather than only hidden in the UI.
func (a *API) ensureWritable(r *http.Request) error {
	c, ok := a.store.Get(chi.URLParam(r, "id"))
	if !ok {
		return config.ErrNotFound
	}
	if c.ReadOnly {
		return errReadOnly
	}
	return nil
}

// requireWrite writes the appropriate error and reports whether the request may
// proceed with a write.
func (a *API) requireWrite(w http.ResponseWriter, r *http.Request) bool {
	if a.auth != nil && !a.auth.CanWrite(r) {
		fail(w, http.StatusForbidden, errReadOnlyAccount)
		return false
	}
	err := a.ensureWritable(r)
	if err == nil {
		return true
	}
	if errors.Is(err, config.ErrNotFound) {
		fail(w, http.StatusNotFound, err)
	} else {
		fail(w, http.StatusForbidden, err)
	}
	return false
}

// requireAccountWrite checks only the account/token write scope. It is used for
// server-side configuration changes that are not tied to a read-only data
// connection (creating or editing connection profiles, connect/disconnect).
func (a *API) requireAccountWrite(w http.ResponseWriter, r *http.Request) bool {
	if a.auth != nil && !a.auth.CanWrite(r) {
		fail(w, http.StatusForbidden, errReadOnlyAccount)
		return false
	}
	return true
}

// requireWritableConnection is requireWrite for an arbitrary connection id,
// used when the target of a cross-connection copy is not the URL's connection.
func (a *API) requireWritableConnection(w http.ResponseWriter, id string) bool {
	connection, ok := a.store.Get(id)
	if !ok {
		fail(w, http.StatusNotFound, config.ErrNotFound)
		return false
	}
	if connection.ReadOnly {
		fail(w, http.StatusForbidden, errReadOnly)
		return false
	}
	return true
}

// requireAdmin reports whether the caller may manage server-wide settings such
// as accounts and scheduled backups. With auth disabled everyone is an admin.
func (a *API) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if a.auth == nil || a.auth.IsAdmin(r) {
		return true
	}
	fail(w, http.StatusForbidden, errors.New("admin access required"))
	return false
}

// readOnly reports whether the connection in the URL is flagged read-only.
func (a *API) readOnly(r *http.Request) bool {
	c, ok := a.store.Get(chi.URLParam(r, "id"))
	return ok && c.ReadOnly
}
