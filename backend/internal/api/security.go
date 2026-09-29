package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/config"
)

// errReadOnly is returned when a write is attempted on a read-only connection.
var errReadOnly = errors.New("connection is read-only; write operations are disabled")

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

// readOnly reports whether the connection in the URL is flagged read-only.
func (a *API) readOnly(r *http.Request) bool {
	c, ok := a.store.Get(chi.URLParam(r, "id"))
	return ok && c.ReadOnly
}
