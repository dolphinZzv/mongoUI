package api

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

const aliasMaxLength = 80

type aliasInput struct {
	Kind         string `json:"kind"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Collection   string `json:"collection"`
	Alias        string `json:"alias"`
}

// getAliases returns the server-wide shared database and collection aliases.
func (a *API) getAliases(w http.ResponseWriter, _ *http.Request) {
	ok(w, a.settings.GetAliases())
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
