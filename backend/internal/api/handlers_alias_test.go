package api

import (
	"net/http"
	"path/filepath"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func aliasTestAPI(t *testing.T) (http.Handler, *config.Settings) {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	return New(store, mongoclient.NewManager(), true, "test", nil, nil, settings).Router(nil), settings
}

func TestAliasEndpoints(t *testing.T) {
	handler, settings := aliasTestAPI(t)

	status, env := doJSON(t, handler, http.MethodGet, "/api/aliases", "")
	if status != http.StatusOK {
		t.Fatalf("GET aliases status = %d", status)
	}
	data := dataOf(t, env)
	if got := data["databases"].(map[string]any); len(got) != 0 {
		t.Fatalf("expected empty database aliases, got %#v", got)
	}

	status, env = doJSON(t, handler, http.MethodPatch, "/api/aliases",
		`{"kind":"database","connectionId":"c1","database":"orders","alias":"Orders DB"}`)
	if status != http.StatusOK {
		t.Fatalf("PATCH database status = %d body %#v", status, env)
	}
	data = dataOf(t, env)
	if data["databases"].(map[string]any)["c1::orders"] != "Orders DB" {
		t.Fatalf("database alias missing: %#v", data)
	}
	if settings.GetAliases().Databases["c1::orders"] != "Orders DB" {
		t.Fatalf("database alias not stored")
	}

	status, env = doJSON(t, handler, http.MethodPatch, "/api/aliases",
		`{"kind":"collection","connectionId":"c1","database":"orders","collection":"items","alias":"Items EN"}`)
	if status != http.StatusOK {
		t.Fatalf("PATCH collection status = %d body %#v", status, env)
	}
	data = dataOf(t, env)
	if data["collections"].(map[string]any)["c1::orders::items"] != "Items EN" {
		t.Fatalf("collection alias missing: %#v", data)
	}

	status, env = doJSON(t, handler, http.MethodGet, "/api/aliases", "")
	if status != http.StatusOK {
		t.Fatalf("GET aliases status = %d", status)
	}
	data = dataOf(t, env)
	if data["databases"].(map[string]any)["c1::orders"] != "Orders DB" ||
		data["collections"].(map[string]any)["c1::orders::items"] != "Items EN" {
		t.Fatalf("aliases not returned: %#v", data)
	}

	// An empty alias removes the entry.
	status, env = doJSON(t, handler, http.MethodPatch, "/api/aliases",
		`{"kind":"database","connectionId":"c1","database":"orders","alias":""}`)
	if status != http.StatusOK {
		t.Fatalf("remove alias status = %d body %#v", status, env)
	}
	data = dataOf(t, env)
	if _, found := data["databases"].(map[string]any)["c1::orders"]; found {
		t.Fatalf("database alias should be removed: %#v", data)
	}
}

func TestAliasValidation(t *testing.T) {
	handler, _ := aliasTestAPI(t)

	for name, body := range map[string]string{
		"bad kind":           `{"kind":"table","connectionId":"c1","database":"db","alias":"x"}`,
		"missing connection": `{"kind":"database","database":"db","alias":"x"}`,
		"missing database":   `{"kind":"database","connectionId":"c1","alias":"x"}`,
		"missing collection": `{"kind":"collection","connectionId":"c1","database":"db","alias":"x"}`,
	} {
		t.Run(name, func(t *testing.T) {
			status, _ := doJSON(t, handler, http.MethodPatch, "/api/aliases", body)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", status, http.StatusBadRequest)
			}
		})
	}
}
