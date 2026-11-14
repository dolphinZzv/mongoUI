package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"mongoui/internal/config"
)

const (
	chartViewsMax      = 100
	chartViewNameMax   = 80
	chartViewScopeMax  = 512
	chartViewConfigMax = 32 << 10
	chartViewFilterMax = 8000
)

type chartViewsInput struct {
	Scope   string             `json:"scope"`
	Version *int64             `json:"version"`
	Views   []config.ChartView `json:"views"`
}

// getChartViews lists shared chart views. With ?connectionId= it returns every
// scope of that connection (used by pinned charts on the overview).
func (a *API) canAccessScope(r *http.Request, scope string) bool {
	if a.auth == nil {
		return true
	}
	parts := strings.SplitN(scope, "::", 2)
	return len(parts) == 2 && parts[0] != "" && a.auth.CanAccessConnection(r, parts[0])
}

func (a *API) getChartViews(w http.ResponseWriter, r *http.Request) {
	if connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId")); connectionID != "" {
		if a.auth != nil && !a.auth.CanAccessConnection(r, connectionID) {
			fail(w, http.StatusForbidden, errConnectionAccess)
			return
		}
		ok(w, map[string]any{"scopes": a.settings.ChartViewsForConnection(connectionID)})
		return
	}
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		badRequest(w, errors.New("scope or connectionId is required"))
		return
	}
	if !a.canAccessScope(r, scope) {
		fail(w, http.StatusForbidden, errConnectionAccess)
		return
	}
	ok(w, map[string]any{
		"version": a.settings.ChartViewsRevision(scope),
		"views":   a.settings.GetChartViews(scope),
	})
}

// updateChartViews replaces the shared views for one scope. Read-only accounts
// may read them but cannot change what the team sees.
func (a *API) updateChartViews(w http.ResponseWriter, r *http.Request) {
	if !a.requireAccountWrite(w, r) {
		return
	}
	var in chartViewsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	scope := strings.TrimSpace(in.Scope)
	if scope == "" {
		badRequest(w, errors.New("scope is required"))
		return
	}
	if utf8.RuneCountInString(scope) > chartViewScopeMax {
		badRequest(w, errors.New("scope is too long"))
		return
	}
	if !a.canAccessScope(r, scope) {
		fail(w, http.StatusForbidden, errConnectionAccess)
		return
	}
	if len(in.Views) > chartViewsMax {
		badRequest(w, errors.New("at most 100 chart views are allowed per scope"))
		return
	}

	views := make([]config.ChartView, 0, len(in.Views))
	for _, view := range in.Views {
		view.ID = strings.TrimSpace(view.ID)
		view.Name = strings.TrimSpace(view.Name)
		if view.ID == "" {
			badRequest(w, errors.New("chart view id is required"))
			return
		}
		if view.Name == "" || utf8.RuneCountInString(view.Name) > chartViewNameMax {
			badRequest(w, errors.New("chart view name must be 1-80 characters"))
			return
		}
		if len(view.Config) == 0 || len(view.Config) > chartViewConfigMax || !json.Valid(view.Config) {
			badRequest(w, errors.New("chart view config must be valid JSON under 32 KiB"))
			return
		}
		if utf8.RuneCountInString(view.Filter) > chartViewFilterMax {
			badRequest(w, errors.New("chart view filter is too long"))
			return
		}
		view.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		view.UpdatedBy = ""
		if a.auth != nil {
			if user, found := a.auth.Current(r); found {
				view.UpdatedBy = user.Username
			}
		}
		views = append(views, view)
	}

	version, err := a.settings.SetChartViews(scope, views, in.Version)
	if errors.Is(err, config.ErrChartViewsConflict) {
		fail(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"version": version, "views": views})
}
