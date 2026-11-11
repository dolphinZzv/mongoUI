package api

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"mongoui/internal/config"
)

const (
	savedQueriesMax    = 100
	savedQueryNameMax  = 80
	savedQueryScopeMax = 512
	savedQueryTextMax  = 64 << 10
	savedQueryKindSQL  = "sql"
	savedQueryKindAgg  = "aggregation"
)

type savedQueriesInput struct {
	Scope   string              `json:"scope"`
	Version *int64              `json:"version"`
	Queries []config.SavedQuery `json:"queries"`
}

func (a *API) getSavedQueries(w http.ResponseWriter, r *http.Request) {
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		badRequest(w, errors.New("scope is required"))
		return
	}
	ok(w, map[string]any{
		"version": a.automationStore.SavedQueriesRevision(scope),
		"queries": a.automationStore.GetSavedQueries(scope),
	})
}

func (a *API) updateSavedQueries(w http.ResponseWriter, r *http.Request) {
	if !a.requireAccountWrite(w, r) {
		return
	}
	var in savedQueriesInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	scope := strings.TrimSpace(in.Scope)
	if scope == "" {
		badRequest(w, errors.New("scope is required"))
		return
	}
	if utf8.RuneCountInString(scope) > savedQueryScopeMax {
		badRequest(w, errors.New("scope is too long"))
		return
	}
	if len(in.Queries) > savedQueriesMax {
		badRequest(w, errors.New("at most 100 saved queries are allowed per scope"))
		return
	}
	queries := make([]config.SavedQuery, 0, len(in.Queries))
	for _, query := range in.Queries {
		query.ID = strings.TrimSpace(query.ID)
		query.Name = strings.TrimSpace(query.Name)
		query.Kind = strings.TrimSpace(query.Kind)
		query.Text = strings.TrimSpace(query.Text)
		if query.ID == "" {
			badRequest(w, errors.New("saved query id is required"))
			return
		}
		if query.Name == "" || utf8.RuneCountInString(query.Name) > savedQueryNameMax {
			badRequest(w, errors.New("saved query name must be 1-80 characters"))
			return
		}
		if query.Kind != savedQueryKindSQL && query.Kind != savedQueryKindAgg {
			badRequest(w, errors.New("saved query kind must be sql or aggregation"))
			return
		}
		if query.Text == "" || len(query.Text) > savedQueryTextMax {
			badRequest(w, errors.New("saved query text must be 1-64 KiB"))
			return
		}
		query.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		query.UpdatedBy = ""
		if a.auth != nil {
			if user, found := a.auth.Current(r); found {
				query.UpdatedBy = user.Username
			}
		}
		queries = append(queries, query)
	}
	version, err := a.automationStore.SetSavedQueries(scope, queries, in.Version)
	if errors.Is(err, config.ErrSavedQueriesConflict) {
		fail(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, map[string]any{"version": version, "queries": queries})
}
