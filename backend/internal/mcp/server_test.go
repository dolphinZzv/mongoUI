package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func newTestServer(t *testing.T, readOnly bool, token string) (*Server, *config.Store) {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	settings := config.NewSettings(config.MCPSettings{Enabled: true, Read: true, Write: !readOnly})
	return New(store, mongoclient.NewManager(), "test", token, settings), store
}

// newTestServerWithConfig builds a server with explicit MCP settings.
func newTestServerWithConfig(t *testing.T, cfg config.MCPSettings, token string) (*Server, *config.Store) {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	return New(store, mongoclient.NewManager(), "test", token, config.NewSettings(cfg)), store
}

// call runs one JSON-RPC message and returns the decoded response.
func call(t *testing.T, s *Server, method string, params any) map[string]any {
	t.Helper()
	msg := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		msg["params"] = params
	}
	raw, _ := json.Marshal(msg)
	resp := s.handle(raw)
	if resp == nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(resp, &out); err != nil {
		t.Fatalf("decode response: %v (raw: %s)", err, resp)
	}
	return out
}

func toolNames(t *testing.T, s *Server) []string {
	t.Helper()
	resp := call(t, s, "tools/list", nil)
	result := resp["result"].(map[string]any)
	list := result["tools"].([]any)
	names := make([]string, 0, len(list))
	for _, item := range list {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	return names
}

func has(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

func TestInitialize(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	resp := call(t, s, "initialize", nil)
	result := resp["result"].(map[string]any)
	if result["protocolVersion"] != protocolVersion {
		t.Fatalf("protocolVersion = %v", result["protocolVersion"])
	}
	info := result["serverInfo"].(map[string]any)
	if info["name"] != "mongoui" {
		t.Fatalf("serverInfo = %v", info)
	}
}

func TestToolsListIncludesWritesByDefault(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	names := toolNames(t, s)
	for _, want := range []string{"mongoui_list_connections", "mongoui_find", "mongoui_sql", "mongoui_insert", "mongoui_delete"} {
		if !has(names, want) {
			t.Errorf("missing tool %q in %v", want, names)
		}
	}
}

func TestReadOnlyHidesAndRejectsWrites(t *testing.T) {
	s, _ := newTestServer(t, true, "")
	names := toolNames(t, s)
	if has(names, "mongoui_insert") || has(names, "mongoui_delete") || has(names, "mongoui_drop_database") {
		t.Fatalf("write tools advertised in read-only mode: %v", names)
	}
	if !has(names, "mongoui_find") || !has(names, "mongoui_sql") {
		t.Fatalf("read tools missing in read-only mode: %v", names)
	}

	resp := call(t, s, "tools/call", map[string]any{
		"name":      "mongoui_insert",
		"arguments": map[string]any{"connectionId": "x", "database": "d", "collection": "c", "documents": []any{}},
	})
	result := resp["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError, got %v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "write group") {
		t.Fatalf("unexpected error text: %s", text)
	}
}

func TestReadOnlyConnectionRejectsWrite(t *testing.T) {
	s, store := newTestServer(t, false, "")
	conn, err := store.Add(config.Connection{Name: "ro", URI: "mongodb://127.0.0.1:27017", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	resp := call(t, s, "tools/call", map[string]any{
		"name": "mongoui_delete",
		"arguments": map[string]any{
			"connectionId": conn.ID, "database": "d", "collection": "c", "filter": map[string]any{},
		},
	})
	result := resp["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError, got %v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "read-only") {
		t.Fatalf("unexpected error text: %s", text)
	}
}

func TestListConnectionsEmpty(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	resp := call(t, s, "tools/call", map[string]any{"name": "mongoui_list_connections", "arguments": map[string]any{}})
	result := resp["result"].(map[string]any)
	if result["isError"] == true {
		t.Fatalf("unexpected error: %v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if strings.TrimSpace(text) != "[]" {
		t.Fatalf("expected empty list, got %s", text)
	}
}

func TestUnknownTool(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	resp := call(t, s, "tools/call", map[string]any{"name": "nope", "arguments": map[string]any{}})
	if resp["response"] != nil {
		t.Fatal("unexpected response field")
	}
	result := resp["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError, got %v", result)
	}
}

func TestHTTPTransport(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	ts := httptest.NewServer(s.HTTPHandler())
	defer ts.Close()

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize"}`
	resp, err := http.Post(ts.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if resp.Header.Get("Mcp-Session-Id") == "" {
		t.Fatal("missing Mcp-Session-Id header")
	}
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	if !strings.Contains(buf.String(), `"name":"mongoui"`) {
		t.Fatalf("unexpected body: %s", buf.String())
	}
}

func TestHTTPTokenRequired(t *testing.T) {
	s, _ := newTestServer(t, false, "secret")
	ts := httptest.NewServer(s.HTTPHandler())
	defer ts.Close()

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize"}`
	resp, err := http.Post(ts.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodPost, ts.URL, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret")
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}
}

func TestStdioRoundTrip(t *testing.T) {
	s, _ := newTestServer(t, false, "")
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}` + "\n" +
		`{"jsonrpc":"2.0","method":"notifications/initialized"}` + "\n" +
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}` + "\n")
	var out bytes.Buffer
	if err := s.ServeStdio(context.Background(), in, &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses, got %d: %q", len(lines), out.String())
	}
	if !strings.Contains(lines[1], "mongoui_list_connections") {
		t.Fatalf("tools/list response missing: %s", lines[1])
	}
}

func TestReadGroupOnlyHidesWrites(t *testing.T) {
	s, _ := newTestServerWithConfig(t, config.MCPSettings{Enabled: true, Read: true, Write: false}, "")
	names := toolNames(t, s)
	if !has(names, "mongoui_find") || !has(names, "mongoui_sql") {
		t.Fatalf("read tools missing: %v", names)
	}
	if has(names, "mongoui_insert") || has(names, "mongoui_drop_database") {
		t.Fatalf("write tools advertised with write group off: %v", names)
	}

	resp := call(t, s, "tools/call", map[string]any{
		"name":      "mongoui_insert",
		"arguments": map[string]any{"connectionId": "x", "database": "d", "collection": "c", "documents": []any{}},
	})
	result := resp["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError, got %v", result)
	}
}

func TestGroupsAreIndependent(t *testing.T) {
	// Write group can be enabled while the read group is off.
	s, _ := newTestServerWithConfig(t, config.MCPSettings{Enabled: true, Read: false, Write: true}, "")
	names := toolNames(t, s)
	if has(names, "mongoui_find") || has(names, "mongoui_sql") {
		t.Fatalf("read tools advertised with read group off: %v", names)
	}
	if !has(names, "mongoui_insert") {
		t.Fatalf("write tool missing with write group on: %v", names)
	}
}

func TestToolDefinitionsCarryGroup(t *testing.T) {
	s, _ := newTestServerWithConfig(t, config.MCPSettings{Enabled: true, Read: true, Write: true}, "")
	resp := call(t, s, "tools/list", nil)
	list := resp["result"].(map[string]any)["tools"].([]any)
	byName := map[string]map[string]any{}
	for _, item := range list {
		tool := item.(map[string]any)
		byName[tool["name"].(string)] = tool
	}
	if got := byName["mongoui_find"]["group"]; got != string(readGroup) {
		t.Fatalf("mongoui_find group = %v, want read", got)
	}
	if got := byName["mongoui_insert"]["group"]; got != string(writeGroup) {
		t.Fatalf("mongoui_insert group = %v, want write", got)
	}
	ann, _ := byName["mongoui_find"]["annotations"].(map[string]any)
	if ann["readOnlyHint"] != true {
		t.Fatalf("mongoui_find readOnlyHint = %v", ann["readOnlyHint"])
	}
}

func TestDisabledServerRejectsTransports(t *testing.T) {
	s, _ := newTestServerWithConfig(t, config.MCPSettings{Enabled: false, Read: true, Write: false}, "")

	ts := httptest.NewServer(s.HTTPHandler())
	defer ts.Close()
	body := `{"jsonrpc":"2.0","id":1,"method":"initialize"}`
	resp, err := http.Post(ts.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 when disabled, got %d", resp.StatusCode)
	}

	if err := s.ServeStdio(context.Background(), strings.NewReader(""), &bytes.Buffer{}); err == nil {
		t.Fatal("expected stdio to refuse to start while disabled")
	}
}
