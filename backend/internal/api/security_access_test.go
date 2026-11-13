package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/auth"
	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestConnectionAccessMiddleware(t *testing.T) {
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	user, err := manager.CreatePasswordUser("alice", auth.RoleReadWrite, "alice password")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateUserConnections(user.ID, []string{"c1"}); err != nil {
		t.Fatal(err)
	}

	login := httptest.NewRequest(http.MethodPost, "/login",
		strings.NewReader(`{"username":"alice","password":"alice password","method":"password"}`))
	loginRec := httptest.NewRecorder()
	manager.Routes().ServeHTTP(loginRec, login)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d", loginRec.Code)
	}
	cookies := loginRec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("login did not set a cookie")
	}

	api := &API{auth: manager}
	router := chi.NewRouter()
	router.Route("/{id}", func(r chi.Router) {
		r.Use(api.connectionAccessMiddleware)
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	})

	allowed := httptest.NewRequest(http.MethodGet, "/c1", nil)
	allowed.AddCookie(cookies[0])
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, allowed)
	if rec.Code != http.StatusOK {
		t.Fatalf("allowed connection status = %d", rec.Code)
	}

	denied := httptest.NewRequest(http.MethodGet, "/c2", nil)
	denied.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, denied)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("denied connection status = %d, want 403", rec.Code)
	}
}

func TestListConnectionsFiltersAllowlist(t *testing.T) {
	store, err := config.NewStore(t.TempDir() + "/connections.json")
	if err != nil {
		t.Fatal(err)
	}
	allowedConn, err := store.Add(config.Connection{Name: "allowed", URI: "mongodb://127.0.0.1:27017"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add(config.Connection{Name: "blocked", URI: "mongodb://127.0.0.1:27017"}); err != nil {
		t.Fatal(err)
	}
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	user, err := manager.CreatePasswordUser("alice", auth.RoleReadWrite, "alice password")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateUserConnections(user.ID, []string{allowedConn.ID}); err != nil {
		t.Fatal(err)
	}
	login := httptest.NewRequest(http.MethodPost, "/login",
		strings.NewReader(`{"username":"alice","password":"alice password","method":"password"}`))
	loginRec := httptest.NewRecorder()
	manager.Routes().ServeHTTP(loginRec, login)
	cookies := loginRec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("login did not set a cookie")
	}

	handler := New(store, mongoclient.NewManager(), true, "test", nil, manager).Router(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
	req.AddCookie(cookies[0])
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data) != 1 || envelope.Data[0].ID != allowedConn.ID {
		t.Fatalf("filtered connections = %#v", envelope.Data)
	}
}
