package api

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func feedbackTestAPI(t *testing.T) http.Handler {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	return New(store, mongoclient.NewManager(), true, "v1.2.3", nil, nil).Router(nil)
}

func TestSubmitFeedbackValidation(t *testing.T) {
	handler := feedbackTestAPI(t)

	for name, body := range map[string]string{
		"missing title": `{"body":"details"}`,
		"missing body":  `{"title":"A title"}`,
		"blank title":   `{"title":"   ","body":"details"}`,
		"long title":    `{"title":"` + strings.Repeat("x", feedbackMaxTitle+1) + `","body":"details"}`,
		"long body":     `{"title":"A title","body":"` + strings.Repeat("x", feedbackMaxBody+1) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			status, _ := doJSON(t, handler, http.MethodPost, "/api/feedback", body)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", status, http.StatusBadRequest)
			}
		})
	}
}

func TestSubmitFeedbackCallsGH(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake gh executable uses a POSIX shell script")
	}

	dir := t.TempDir()
	capture := filepath.Join(dir, "capture.txt")
	gh := filepath.Join(dir, "gh")
	script := `#!/bin/sh
{
  printf '%s\n' "$@"
  echo '---'
  cat
} > "$GH_CAPTURE"
printf 'https://github.com/example/mongoui/issues/7\n'
`
	if err := os.WriteFile(gh, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake gh: %v", err)
	}

	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("GH_CAPTURE", capture)
	t.Setenv("MONGOUI_FEEDBACK_REPO", "example/mongoui")

	handler := feedbackTestAPI(t)
	status, env := doJSON(t, handler, http.MethodPost, "/api/feedback",
		`{"title":"Crash on login","body":"Steps to reproduce..."}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %#v", status, env)
	}
	data := dataOf(t, env)
	if data["url"] != "https://github.com/example/mongoui/issues/7" {
		t.Fatalf("unexpected issue URL: %#v", data["url"])
	}

	raw, err := os.ReadFile(capture)
	if err != nil {
		t.Fatalf("read gh args: %v", err)
	}
	captured := string(raw)
	for _, want := range []string{
		"issue\ncreate",
		"--repo\nexample/mongoui",
		"--title\nCrash on login",
		"--body-file\n-",
		"Steps to reproduce...",
		"- MongoUI version: v1.2.3",
	} {
		if !strings.Contains(captured, want) {
			t.Fatalf("gh invocation missing %q:\n%s", want, captured)
		}
	}
}

func TestSubmitFeedbackReportsGHFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake gh executable uses a POSIX shell script")
	}

	dir := t.TempDir()
	gh := filepath.Join(dir, "gh")
	script := "#!/bin/sh\necho 'not logged in' >&2\nexit 1\n"
	if err := os.WriteFile(gh, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake gh: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("MONGOUI_FEEDBACK_REPO", "example/mongoui")

	handler := feedbackTestAPI(t)
	status, env := doJSON(t, handler, http.MethodPost, "/api/feedback",
		`{"title":"A title","body":"details"}`)
	if status != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d (body %#v)", status, http.StatusBadGateway, env)
	}
	if msg, _ := env["error"].(string); !strings.Contains(msg, "not logged in") {
		t.Fatalf("error should include gh output: %#v", env)
	}
}
