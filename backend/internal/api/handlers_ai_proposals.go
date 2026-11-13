package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (a *API) aiActor(r *http.Request) string {
	if a.auth != nil {
		if user, ok := a.auth.Current(r); ok && user.Username != "" {
			return user.Username
		}
	}
	return "local"
}

func (a *API) requireMCP(w http.ResponseWriter) bool {
	if a.mcpServer == nil {
		fail(w, http.StatusServiceUnavailable, errors.New("MCP proposal store is not available"))
		return false
	}
	return true
}

func (a *API) listAIProposals(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) || !a.requireMCP(w) {
		return
	}
	ok(w, map[string]any{"proposals": a.mcpServer.Proposals()})
}

func (a *API) approveAIProposal(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) || !a.requireMCP(w) {
		return
	}
	if err := a.mcpServer.ApproveProposal(chi.URLParam(r, "id"), a.aiActor(r)); err != nil {
		badRequest(w, err)
		return
	}
	ok(w, map[string]any{"approved": true})
}

func (a *API) rejectAIProposal(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) || !a.requireMCP(w) {
		return
	}
	if err := a.mcpServer.RejectProposal(chi.URLParam(r, "id"), a.aiActor(r)); err != nil {
		badRequest(w, err)
		return
	}
	ok(w, map[string]any{"rejected": true})
}

func (a *API) applyAIProposal(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) || !a.requireMCP(w) {
		return
	}
	result, err := a.mcpServer.ApplyProposal(chi.URLParam(r, "id"))
	if err != nil {
		badRequest(w, err)
		return
	}
	ok(w, map[string]any{"applied": true, "result": result})
}

func (a *API) rollbackAIProposal(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) || !a.requireMCP(w) {
		return
	}
	if err := a.mcpServer.RollbackProposal(chi.URLParam(r, "id")); err != nil {
		badRequest(w, err)
		return
	}
	ok(w, map[string]any{"rolledBack": true})
}
