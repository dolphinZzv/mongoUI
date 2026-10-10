package api

import (
	"path/filepath"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestMCPSettingsEndpoints(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	settings := config.NewSettings(config.MCPSettings{Enabled: false, Read: false, Write: false})
	handler := New(store, mongoclient.NewManager(), true, "test", nil, nil, settings).Router(nil)

	// Initial state reflects the provided settings.
	status, env := doJSON(t, handler, "GET", "/api/mcp", "")
	if status != 200 {
		t.Fatalf("GET status = %d", status)
	}
	data := dataOf(t, env)
	if data["enabled"] != false || data["read"] != false || data["write"] != false {
		t.Fatalf("unexpected initial settings: %#v", data)
	}

	// Enabling MCP without naming the read group turns it on by default.
	status, env = doJSON(t, handler, "PUT", "/api/mcp", `{"enabled":true}`)
	if status != 200 {
		t.Fatalf("PUT status = %d", status)
	}
	data = dataOf(t, env)
	if data["enabled"] != true || data["read"] != true {
		t.Fatalf("enabling MCP should default the read group on: %#v", data)
	}
	if data["write"] != false {
		t.Fatalf("write group should stay off by default: %#v", data)
	}

	// The write group is opt-in.
	status, env = doJSON(t, handler, "PUT", "/api/mcp", `{"write":true}`)
	if status != 200 {
		t.Fatalf("PUT status = %d", status)
	}
	data = dataOf(t, env)
	if data["write"] != true {
		t.Fatalf("write group not enabled: %#v", data)
	}

	// Disabling MCP leaves the group choices untouched.
	status, env = doJSON(t, handler, "PUT", "/api/mcp", `{"enabled":false}`)
	if status != 200 {
		t.Fatalf("PUT status = %d", status)
	}
	data = dataOf(t, env)
	if data["enabled"] != false || data["read"] != true || data["write"] != true {
		t.Fatalf("disabling MCP should keep groups: %#v", data)
	}

	if got := settings.GetMCP(); got.Enabled || !got.Read || !got.Write {
		t.Fatalf("settings not persisted: %#v", got)
	}
}
