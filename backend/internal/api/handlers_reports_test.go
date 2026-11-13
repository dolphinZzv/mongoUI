package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/automation"
	"mongoui/internal/config"
)

func TestReportsConfigHandlers(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	conn, err := store.Add(config.Connection{Name: "it", URI: "mongodb://127.0.0.1:27017"})
	if err != nil {
		t.Fatal(err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	api := &API{store: store, settings: settings, automationStore: automation.NewStore(settings, nil)}

	rec := httptest.NewRecorder()
	api.getReports(rec, httptest.NewRequest(http.MethodGet, "/reports", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"reports":[]`) {
		t.Fatalf("empty list = %d %s", rec.Code, rec.Body.String())
	}

	body := `{"reports":[{"id":"r1","name":"daily","connectionId":"` + conn.ID + `","database":"db","collection":"c","filter":"{}","intervalSeconds":60,"emailTo":"ops@example.com","enabled":true}]}`
	rec = httptest.NewRecorder()
	api.updateReports(rec, httptest.NewRequest(http.MethodPut, "/reports", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("save = %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"daily"`) || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("saved reports = %s", rec.Body.String())
	}

	invalid := `{"reports":[{"id":"r2","name":"bad","connectionId":"` + conn.ID + `","database":"db","collection":"c","pipeline":"[{\"$out\":\"x\"}]","intervalSeconds":60,"emailTo":"ops@example.com"}]}`
	rec = httptest.NewRecorder()
	api.updateReports(rec, httptest.NewRequest(http.MethodPut, "/reports", strings.NewReader(invalid)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("write pipeline status = %d, want 400", rec.Code)
	}

	missingTarget := `{"reports":[{"id":"r3","name":"bad","connectionId":"` + conn.ID + `","database":"db","collection":"c","intervalSeconds":60}]}`
	rec = httptest.NewRecorder()
	api.updateReports(rec, httptest.NewRequest(http.MethodPut, "/reports", strings.NewReader(missingTarget)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing destination status = %d, want 400", rec.Code)
	}
}
