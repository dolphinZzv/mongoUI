package api

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"mongoui/internal/config"
)

const aliasMaxLength = 80

type aliasInput struct {
	Kind         string `json:"kind"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Collection   string `json:"collection"`
	Alias        string `json:"alias"`
}

// getAliases returns the shared database and collection aliases visible to the
// caller. Aliases for other connections must not leak database/collection names.
func (a *API) getAliases(w http.ResponseWriter, r *http.Request) {
	aliases := a.settings.GetAliases()
	if a.auth == nil || a.auth.IsAdmin(r) {
		ok(w, aliases)
		return
	}
	visible := config.AliasSettings{Databases: map[string]string{}, Collections: map[string]string{}}
	for key, value := range aliases.Databases {
		if a.aliasConnectionAllowed(r, key) {
			visible.Databases[key] = value
		}
	}
	for key, value := range aliases.Collections {
		if a.aliasConnectionAllowed(r, key) {
			visible.Collections[key] = value
		}
	}
	ok(w, visible)
}

func (a *API) aliasConnectionAllowed(r *http.Request, key string) bool {
	parts := strings.SplitN(key, "::", 2)
	return len(parts) == 2 && parts[0] != "" && a.auth.CanAccessConnection(r, parts[0])
}

// updateAlias creates, updates or removes one shared alias. An empty alias
// removes it. Read-only accounts may still read aliases but cannot modify them.
func (a *API) updateAlias(w http.ResponseWriter, r *http.Request) {
	if !a.requireAccountWrite(w, r) {
		return
	}
	var in aliasInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	in.Kind = strings.TrimSpace(in.Kind)
	in.ConnectionID = strings.TrimSpace(in.ConnectionID)
	in.Database = strings.TrimSpace(in.Database)
	in.Collection = strings.TrimSpace(in.Collection)
	in.Alias = strings.TrimSpace(in.Alias)

	if in.Kind != "database" && in.Kind != "collection" {
		badRequest(w, errors.New("alias kind must be database or collection"))
		return
	}
	if in.ConnectionID == "" || in.Database == "" {
		badRequest(w, errors.New("connectionId and database are required"))
		return
	}
	if a.auth != nil && !a.auth.CanAccessConnection(r, in.ConnectionID) {
		fail(w, http.StatusForbidden, errConnectionAccess)
		return
	}
	if in.Kind == "collection" && in.Collection == "" {
		badRequest(w, errors.New("collection is required for a collection alias"))
		return
	}
	if utf8.RuneCountInString(in.Alias) > aliasMaxLength {
		badRequest(w, errors.New("alias must be at most 80 characters"))
		return
	}

	aliases, err := a.settings.SetAlias(in.Kind, in.ConnectionID, in.Database, in.Collection, in.Alias)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, aliases)
}
