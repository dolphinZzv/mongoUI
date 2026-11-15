package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mongoui/internal/config"
)

func TestGenerateOpenAI(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"status\":\"active\"}"}}]}`))
	}))
	defer server.Close()

	got, err := GenerateFilter(context.Background(), config.AISettings{
		Provider: "openai",
		BaseURL:  server.URL,
		APIKey:   "test-key",
	}, "active documents")
	if err != nil {
		t.Fatalf("GenerateFilter: %v", err)
	}
	if got != `{"status":"active"}` {
		t.Fatalf("response = %q", got)
	}
}

func TestGenerateOpenAIResponses(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"{\"status\":\"active\"}"}]}]}`))
	}))
	defer server.Close()

	got, err := GenerateFilter(context.Background(), config.AISettings{
		Provider: "openai",
		BaseURL:  server.URL,
		APIMode:  "responses",
		APIKey:   "test-key",
	}, "active documents")
	if err != nil {
		t.Fatalf("GenerateFilter: %v", err)
	}
	if got != `{"status":"active"}` {
		t.Fatalf("response = %q", got)
	}
}

func TestGenerateGemini(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models/gemini-test:generateContent" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("key") != "test-key" {
			t.Fatalf("key query missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"age\":{\"$gte\":18}}"}]}}]}`))
	}))
	defer server.Close()

	got, err := GenerateFilter(context.Background(), config.AISettings{
		Provider: "gemini",
		BaseURL:  server.URL,
		Model:    "gemini-test",
		APIKey:   "test-key",
	}, "adults")
	if err != nil {
		t.Fatalf("GenerateFilter: %v", err)
	}
	if got != `{"age":{"$gte":18}}` {
		t.Fatalf("response = %q", got)
	}
}

func TestGenerateADK(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "1")
	var sessionCalled, runCalled, deleteCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/apps/agent/users/user/sessions":
			sessionCalled = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"s1"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/run":
			runCalled = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"content":{"parts":[{"text":"{\"status\":\"ok\"}"}]}}]`))
		case r.Method == http.MethodDelete:
			deleteCalled = true
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	got, err := GenerateFilter(context.Background(), config.AISettings{
		Provider:    "adk",
		ADKEndpoint: server.URL,
		ADKAppName:  "agent",
		ADKUserID:   "user",
	}, "status ok")
	if err != nil {
		t.Fatalf("GenerateFilter: %v", err)
	}
	if got != `{"status":"ok"}` {
		t.Fatalf("response = %q", got)
	}
	if !sessionCalled || !runCalled || !deleteCalled {
		t.Fatalf("ADK lifecycle incomplete: session=%v run=%v delete=%v", sessionCalled, runCalled, deleteCalled)
	}
}

func TestValidateURLRejectsPrivateEndpoints(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "0")
	for _, endpoint := range []string{
		"http://127.0.0.1:8080",
		"http://localhost:11434",
		"http://169.254.169.254/latest/meta-data",
		"http://10.0.0.1",
	} {
		if err := ValidateURL(endpoint); err == nil {
			t.Errorf("ValidateURL(%q) allowed a private endpoint", endpoint)
		}
	}
	if err := ValidateURL("https://api.openai.com/v1"); err != nil {
		t.Fatalf("public URL rejected: %v", err)
	}
}

func TestSafeTransportRejectsPrivateAddress(t *testing.T) {
	t.Setenv("MONGOUI_ALLOW_PRIVATE_AI", "0")
	_, err := httpClient.Get("http://127.0.0.1:1")
	if err == nil || !strings.Contains(err.Error(), "private or loopback") {
		t.Fatalf("expected private-address rejection, got %v", err)
	}
}
