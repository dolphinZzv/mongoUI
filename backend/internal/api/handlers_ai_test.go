package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func aiTestAPI(t *testing.T) (http.Handler, *config.Settings) {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	key := make([]byte, 32)
	cipher, err := config.NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	settings.SetCipher(cipher)
	return New(store, mongoclient.NewManager(), true, "test", nil, nil, settings).Router(nil), settings
}

func TestAISettingsEndpoints(t *testing.T) {
	handler, settings := aiTestAPI(t)

	status, env := doJSON(t, handler, http.MethodGet, "/api/ai", "")
	if status != http.StatusOK {
		t.Fatalf("GET /api/ai status = %d", status)
	}
	data := dataOf(t, env)
	if data["provider"] != "" || data["hasAPIKey"] != false {
		t.Fatalf("unexpected initial AI settings: %#v", data)
	}

	status, env = doJSON(t, handler, http.MethodPut, "/api/ai",
		`{"provider":"openai","baseURL":"https://api.openai.com/v1","model":"gpt-4o-mini","apiKey":"secret-key"}`)
	if status != http.StatusOK {
		t.Fatalf("PUT /api/ai status = %d body %#v", status, env)
	}
	data = dataOf(t, env)
	if data["hasAPIKey"] != true || data["apiKey"] != nil {
		t.Fatalf("API key must be redacted: %#v", data)
	}
	cfg, err := settings.GetAI(config.LocalAIUser)
	if err != nil {
		t.Fatalf("GetAI: %v", err)
	}
	if cfg.APIKey != "secret-key" {
		t.Fatalf("API key not stored/decrypted")
	}

	status, env = doJSON(t, handler, http.MethodPut, "/api/ai",
		`{"provider":"openai","baseURL":"https://api.openai.com/v1","model":"gpt-4o-mini","apiMode":"responses"}`)
	if status != http.StatusOK {
		t.Fatalf("update without key status = %d body %#v", status, env)
	}
	cfg, _ = settings.GetAI(config.LocalAIUser)
	if cfg.APIKey != "secret-key" {
		t.Fatalf("empty apiKey should preserve the existing key")
	}
	if cfg.APIMode != "responses" {
		t.Fatalf("API mode not stored: %#v", cfg)
	}

	status, env = doJSON(t, handler, http.MethodPut, "/api/ai",
		`{"provider":"openai","baseURL":"https://api.openai.com/v1","model":"gpt-4o-mini","clearAPIKey":true}`)
	if status != http.StatusOK {
		t.Fatalf("clear key status = %d body %#v", status, env)
	}
	data = dataOf(t, env)
	if data["hasAPIKey"] != false {
		t.Fatalf("API key should be cleared: %#v", data)
	}
}

func TestGenerateAIFilterEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body := "{\"choices\":[{\"message\":{\"content\":\"```json\\n{\\\"status\\\":\\\"active\\\",\\\"age\\\":{\\\"$gte\\\":18}}\\n```\"}}]}"
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	handler, _ := aiTestAPI(t)
	status, env := doJSON(t, handler, http.MethodPut, "/api/ai",
		`{"provider":"openai","baseURL":"`+server.URL+`","model":"test","apiKey":"secret"}`)
	if status != http.StatusOK {
		t.Fatalf("configure AI status = %d body %#v", status, env)
	}

	status, env = doJSON(t, handler, http.MethodPost, "/api/ai/filter",
		`{"description":"active adults","database":"db","collection":"users","fields":["status","age"],"fieldTypes":{"status":"string","age":"int"}}`)
	if status != http.StatusOK {
		t.Fatalf("POST /api/ai/filter status = %d body %#v", status, env)
	}
	data := dataOf(t, env)
	filter, ok := data["filter"].(map[string]any)
	if !ok || filter["status"] != "active" {
		t.Fatalf("unexpected filter: %#v", data)
	}
}

func TestAIFilterRequiresConfiguration(t *testing.T) {
	handler, _ := aiTestAPI(t)
	status, _ := doJSON(t, handler, http.MethodPost, "/api/ai/filter",
		`{"description":"active","database":"db","collection":"users","fields":["status"]}`)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", status, http.StatusServiceUnavailable)
	}
}

func TestAITestEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"}}]}`))
	}))
	defer server.Close()

	handler, _ := aiTestAPI(t)
	status, env := doJSON(t, handler, http.MethodPost, "/api/ai/test",
		`{"provider":"openai","baseURL":"`+server.URL+`","model":"test","apiKey":"secret"}`)
	if status != http.StatusOK {
		t.Fatalf("POST /api/ai/test status = %d body %#v", status, env)
	}
	data := dataOf(t, env)
	if data["provider"] != "openai" || data["model"] != "test" {
		t.Fatalf("unexpected test response: %#v", data)
	}
}

func TestAITestEndpointRequiresCredentials(t *testing.T) {
	handler, _ := aiTestAPI(t)
	status, _ := doJSON(t, handler, http.MethodPost, "/api/ai/test",
		`{"provider":"openai","baseURL":"https://api.openai.com/v1"}`)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", status, http.StatusServiceUnavailable)
	}
}
