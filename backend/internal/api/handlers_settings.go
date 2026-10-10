package api

import (
	"net/http"
)

// mcpSettingsInput is a partial update: omitted fields keep their current value.
type mcpSettingsInput struct {
	Enabled *bool `json:"enabled"`
	Read    *bool `json:"read"`
	Write   *bool `json:"write"`
}

// getMCPSettings returns the current server MCP configuration.
func (a *API) getMCPSettings(w http.ResponseWriter, _ *http.Request) {
	ok(w, a.settings.GetMCP())
}

// updateMCPSettings updates the server MCP configuration. Switching MCP on
// without specifying the read group enables it, so read tools are available by
// default while the write group stays opt-in.
func (a *API) updateMCPSettings(w http.ResponseWriter, r *http.Request) {
	var in mcpSettingsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}

	cfg := a.settings.GetMCP()
	if in.Enabled != nil {
		cfg.Enabled = *in.Enabled
	}
	if in.Read != nil {
		cfg.Read = *in.Read
	}
	if in.Write != nil {
		cfg.Write = *in.Write
	}
	// Default the read group on when MCP is switched on in the same request
	// and the caller did not explicitly choose a value for it.
	if in.Enabled != nil && *in.Enabled && in.Read == nil {
		cfg.Read = true
	}

	if err := a.settings.SetMCP(cfg); err != nil {
		serverError(w, err)
		return
	}
	ok(w, cfg)
}
