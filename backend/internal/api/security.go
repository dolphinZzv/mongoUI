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

// errConnectionAccess is returned when an account is not allowed to use a
// connection profile.
var errConnectionAccess = errors.New("account is not allowed to access this connection")

// errConnectionReadOnly is returned when the account may read a connection but
// its per-connection role does not allow writes.
var errConnectionReadOnly = errors.New("connection is read-only for this account")

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
	if a.auth != nil {
		if !a.auth.CanAccessConnection(r, chi.URLParam(r, "id")) {
			fail(w, http.StatusForbidden, errConnectionAccess)
			return false
		}
		if !a.auth.CanWrite(r) {
			fail(w, http.StatusForbidden, errReadOnlyAccount)
			return false
		}
		if !a.auth.CanWriteConnection(r, chi.URLParam(r, "id")) {
			fail(w, http.StatusForbidden, errConnectionReadOnly)
			return false
		}
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
func (a *API) requireWritableConnection(w http.ResponseWriter, r *http.Request, id string) bool {
	if a.auth != nil && !a.auth.CanAccessConnection(r, id) {
		fail(w, http.StatusForbidden, errConnectionAccess)
		return false
	}
	if a.auth != nil && !a.auth.CanWriteConnection(r, id) {
		fail(w, http.StatusForbidden, errConnectionReadOnly)
		return false
	}
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

// connectionAccessMiddleware enforces the per-account connection allowlist for
// every route carrying a connection id. Routes without an id (list/create) do
// their own filtering.
func (a *API) connectionAccessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id != "" && a.auth != nil && !a.auth.CanAccessConnection(r, id) {
			fail(w, http.StatusForbidden, errConnectionAccess)
			return
		}
		next.ServeHTTP(w, r)
	})
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
