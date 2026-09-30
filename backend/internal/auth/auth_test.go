package auth

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"mongoui/internal/config"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	m, err := New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	return m
}

func TestSetupAndLoginFlow(t *testing.T) {
	m := newTestManager(t)
	if m.Enabled() {
		t.Fatal("should not be enabled initially")
	}

	secret, uri, qr, err := m.BeginSetup()
	if err != nil {
		t.Fatal(err)
	}
	if secret == "" || !strings.HasPrefix(uri, "otpauth://") || !strings.HasPrefix(qr, "data:image/png;base64,") {
		t.Fatalf("unexpected setup payload: %q %q %q", secret, uri, qr)
	}

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := m.ConfirmSetup("000000"); err == nil {
		t.Fatal("expected an invalid code to be rejected")
	}
	if err := m.ConfirmSetup(code); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if !m.Enabled() {
		t.Fatal("should be enabled after confirm")
	}

	if !m.validSession(m.newSession()) {
		t.Fatal("fresh session should be valid")
	}
	if m.validSession("nope.nope") {
		t.Fatal("forged session accepted")
	}

	if err := m.Login("000000"); err == nil {
		t.Fatal("expected invalid login code")
	}
	code2, _ := totp.GenerateCode(secret, time.Now())
	if err := m.Login(code2); err != nil {
		t.Fatalf("login: %v", err)
	}
}

func TestMiddleware(t *testing.T) {
	m := newTestManager(t)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	guarded := m.Middleware(next)

	// Disabled: passes through.
	rec := httptest.NewRecorder()
	guarded.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/connections", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("disabled middleware = %d", rec.Code)
	}

	secret, _, _, _ := m.BeginSetup()
	code, _ := totp.GenerateCode(secret, time.Now())
	if err := m.ConfirmSetup(code); err != nil {
		t.Fatal(err)
	}

	// Enabled, no cookie: 401.
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/connections", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", rec.Code)
	}

	// Enabled, valid session cookie: 200.
	req := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: m.newSession()})
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated = %d, want 200", rec.Code)
	}
}

func TestPersistenceEncryptsSecret(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{5}, 32)
	cipher, err := config.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}

	m, err := New(dir, cipher, key)
	if err != nil {
		t.Fatal(err)
	}
	secret, _, _, _ := m.BeginSetup()
	code, _ := totp.GenerateCode(secret, time.Now())
	if err := m.ConfirmSetup(code); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret) {
		t.Fatal("TOTP secret stored in plaintext")
	}

	reloaded, err := New(dir, cipher, key)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.Enabled() {
		t.Fatal("not enabled after reload")
	}
	code2, _ := totp.GenerateCode(secret, time.Now())
	if err := reloaded.Login(code2); err != nil {
		t.Fatalf("login after reload: %v", err)
	}
}

func TestWrongMasterKeyFails(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{5}, 32)
	cipher, _ := config.NewCipher(key)
	m, _ := New(dir, cipher, key)
	secret, _, _, _ := m.BeginSetup()
	code, _ := totp.GenerateCode(secret, time.Now())
	if err := m.ConfirmSetup(code); err != nil {
		t.Fatal(err)
	}

	otherKey := bytes.Repeat([]byte{6}, 32)
	otherCipher, _ := config.NewCipher(otherKey)
	if _, err := New(dir, otherCipher, otherKey); err == nil {
		t.Fatal("expected a decryption error with the wrong master key")
	}
}
