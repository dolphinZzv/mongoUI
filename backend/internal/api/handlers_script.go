package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/mongoscript"
)

type scriptRequest struct {
	Script string `json:"script"`
	// Limit optionally caps the documents returned by find/aggregate.
	Limit int64 `json:"limit"`
}

// runScript parses and executes a mongosh-style script against the database in
// the URL. Scripts that only read are allowed everywhere; scripts containing a
// write require a writable connection and account.
func (a *API) runScript(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}

	var req scriptRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	if strings.TrimSpace(req.Script) == "" {
		badRequest(w, errors.New("script is required"))
		return
	}

	stmts, err := mongoscript.Parse(req.Script)
	if err != nil {
		badRequest(w, err)
		return
	}
	if len(stmts) == 0 {
		badRequest(w, errors.New("script is empty"))
		return
	}

	wrote := mongoscript.IsWrite(stmts)
	if wrote && !a.requireWrite(w, r) {
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	runner := &mongoscript.Runner{
		DB:           client.Database(chi.URLParam(r, "db")),
		DefaultLimit: limit,
		MaxLimit:     maxLimit,
	}

	ctx, cancel := withTimeout(r)
	defer cancel()
	results := runner.Run(ctx, stmts)

	payload := make([]map[string]any, 0, len(results))
	for _, res := range results {
		item := map[string]any{
			"statement": res.Statement,
			"ok":        res.OK,
			"kind":      res.Kind,
		}
		if res.Error != "" {
			item["error"] = res.Error
		}
		switch res.Kind {
		case "documents":
			raw, err := toExtJSON(res.Documents)
			if err != nil {
				serverError(w, err)
				return
			}
			item["documents"] = raw
			item["count"] = res.Count
		case "value", "write", "ack":
			raw, err := toExtJSON(res.Value)
			if err != nil {
				serverError(w, err)
				return
			}
			item["value"] = raw
		}
		payload = append(payload, item)
	}

	ok(w, map[string]any{
		"results": payload,
		"summary": mongoscript.Summary(stmts),
		"wrote":   wrote,
	})
}
