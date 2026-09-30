package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

type connectionInput struct {
	Name     string            `json:"name"`
	URI      string            `json:"uri"`
	Color    string            `json:"color"`
	ReadOnly bool              `json:"readOnly"`
	SSH      *config.SSHConfig `json:"ssh,omitempty"`
}

func (in *connectionInput) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	in.URI = strings.TrimSpace(in.URI)
	if in.Name == "" {
		return errors.New("name is required")
	}
	if in.URI == "" {
		return errors.New("uri is required")
	}
	if !strings.HasPrefix(in.URI, "mongodb://") && !strings.HasPrefix(in.URI, "mongodb+srv://") {
		return errors.New("uri must start with mongodb:// or mongodb+srv://")
	}
	if in.SSH != nil && in.SSH.Enabled {
		in.SSH.Host = strings.TrimSpace(in.SSH.Host)
		in.SSH.User = strings.TrimSpace(in.SSH.User)
		if in.SSH.Host == "" {
			return errors.New("ssh host is required")
		}
		if in.SSH.User == "" {
			return errors.New("ssh user is required")
		}
		if in.SSH.Port <= 0 {
			in.SSH.Port = 22
		}
		if in.SSH.Port > 65535 {
			return errors.New("ssh port must be between 1 and 65535")
		}
		switch in.SSH.AuthMethod {
		case "", "password", "privateKey":
		default:
			return errors.New("ssh authMethod must be password or privateKey")
		}
	} else {
		in.SSH = nil
	}
	return nil
}

type connectionView struct {
	config.Connection
	Connected bool `json:"connected"`
}

func (a *API) listConnections(w http.ResponseWriter, _ *http.Request) {
	conns := a.store.List()
	views := make([]connectionView, 0, len(conns))
	for _, c := range conns {
		// List responses are redacted: the UI only needs names/state, and
		// credentials are fetched per connection when editing.
		views = append(views, connectionView{Connection: redactConnection(c), Connected: a.mgr.IsConnected(c.ID)})
	}
	ok(w, views)
}

func (a *API) getConnection(w http.ResponseWriter, r *http.Request) {
	c, found := a.store.Get(chi.URLParam(r, "id"))
	if !found {
		fail(w, http.StatusNotFound, config.ErrNotFound)
		return
	}
	ok(w, connectionView{Connection: c, Connected: a.mgr.IsConnected(c.ID)})
}

func (a *API) createConnection(w http.ResponseWriter, r *http.Request) {
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	if err := in.validate(); err != nil {
		badRequest(w, err)
		return
	}
	c, err := a.store.Add(config.Connection{
		Name:     in.Name,
		URI:      in.URI,
		Color:    in.Color,
		ReadOnly: in.ReadOnly,
		SSH:      in.SSH,
	})
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, connectionView{Connection: c, Connected: false})
}

func (a *API) updateConnection(w http.ResponseWriter, r *http.Request) {
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	if err := in.validate(); err != nil {
		badRequest(w, err)
		return
	}
	id := chi.URLParam(r, "id")
	c, err := a.store.Update(id, config.Connection{
		Name:     in.Name,
		URI:      in.URI,
		Color:    in.Color,
		ReadOnly: in.ReadOnly,
		SSH:      in.SSH,
	})
	if err != nil {
		if errors.Is(err, config.ErrNotFound) {
			fail(w, http.StatusNotFound, err)
			return
		}
		serverError(w, err)
		return
	}
	// Reconnect if the profile was live so new settings take effect.
	if a.mgr.IsConnected(id) {
		a.mgr.Disconnect(id)
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := a.mgr.Connect(ctx, id, c.URI, c.SSH); err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
	}
	ok(w, connectionView{Connection: c, Connected: a.mgr.IsConnected(id)})
}

func (a *API) deleteConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	a.mgr.Disconnect(id)
	if err := a.store.Delete(id); err != nil {
		if errors.Is(err, config.ErrNotFound) {
			fail(w, http.StatusNotFound, err)
			return
		}
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"id": id})
}

func (a *API) connect(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c, found := a.store.Get(id)
	if !found {
		fail(w, http.StatusNotFound, config.ErrNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := a.mgr.Connect(ctx, id, c.URI, c.SSH); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, connectionView{Connection: c, Connected: true})
}

func (a *API) disconnect(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	a.mgr.Disconnect(id)
	ok(w, map[string]any{"id": id, "connected": false})
}

func (a *API) testConnection(w http.ResponseWriter, r *http.Request) {
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	if err := in.validate(); err != nil {
		badRequest(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := mongoclient.Test(ctx, in.URI, in.SSH); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, map[string]any{"ok": true, "message": "Connection successful"})
}
