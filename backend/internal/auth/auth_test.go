package auth

import (
	"bytes"
	"fmt"
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

func requestWithSession(m *Manager, userID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: m.newSession(userID)})
	return req
}

func newCode(t *testing.T, secret string) string {
	t.Helper()
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return code
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

	if _, err := m.ConfirmSetup("000000"); err == nil {
		t.Fatal("expected an invalid code to be rejected")
	}
	adminID, err := m.ConfirmSetup(newCode(t, secret))
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if !m.Enabled() {
		t.Fatal("should be enabled after confirm")
	}

	if _, ok := m.validSession(m.newSession(adminID)); !ok {
		t.Fatal("fresh session should be valid")
	}
	if _, ok := m.validSession("nope.nope"); ok {
		t.Fatal("forged session accepted")
	}

	if _, err := m.Login("admin", "000000"); err == nil {
		t.Fatal("expected invalid login code")
	}
	user, err := m.Login("admin", newCode(t, secret))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if user.Role != RoleAdmin {
		t.Fatalf("expected admin role, got %q", user.Role)
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
	adminID, err := m.ConfirmSetup(newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}

	// Enabled, no cookie: 401.
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/connections", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", rec.Code)
	}

	// Enabled, valid session cookie: 200.
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, requestWithSession(m, adminID))
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated = %d, want 200", rec.Code)
	}
}

func TestRolesEnforced(t *testing.T) {
	m := newTestManager(t)
	adminSecret, _, _, _ := m.BeginSetup()
	adminID, err := m.ConfirmSetup(newCode(t, adminSecret))
	if err != nil {
		t.Fatal(err)
	}

	id, secret, _, _, err := m.BeginUserSetup("viewer", RoleReadOnly)
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := m.ConfirmUserSetup(id, newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}

	admin := requestWithSession(m, adminID)
	readonly := requestWithSession(m, viewer.ID)

	if role, ok := m.Role(admin); !ok || role != RoleAdmin {
		t.Fatalf("admin role = %q ok=%v", role, ok)
	}
	if !m.CanWrite(admin) || !m.IsAdmin(admin) {
		t.Fatal("admin should be able to write and manage users")
	}
	if role, ok := m.Role(readonly); !ok || role != RoleReadOnly {
		t.Fatalf("viewer role = %q ok=%v", role, ok)
	}
	if m.CanWrite(readonly) {
		t.Fatal("read-only account should not be able to write")
	}
	if m.IsAdmin(readonly) {
		t.Fatal("read-only account should not be an admin")
	}
}

func TestLastAdminProtection(t *testing.T) {
	m := newTestManager(t)
	secret, _, _, _ := m.BeginSetup()
	adminID, err := m.ConfirmSetup(newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}

	if err := m.UpdateUserRole(adminID, RoleReadOnly); err == nil {
		t.Fatal("expected the last admin to be protected from demotion")
	}
	if err := m.DeleteUser(adminID); err == nil {
		t.Fatal("expected the last admin to be protected from deletion")
	}

	id, secret2, _, _, err := m.BeginUserSetup("admin2", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmUserSetup(id, newCode(t, secret2)); err != nil {
		t.Fatal(err)
	}
	if err := m.UpdateUserRole(adminID, RoleReadWrite); err != nil {
		t.Fatalf("demoting with two admins should succeed: %v", err)
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
	if _, err := m.ConfirmSetup(newCode(t, secret)); err != nil {
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
	if _, err := reloaded.Login("admin", newCode(t, secret)); err != nil {
		t.Fatalf("login after reload: %v", err)
	}
}

func TestLegacyConfigMigrates(t *testing.T) {
	dir := t.TempDir()
	key := []byte("test-master-key")
	keyOTP, err := totp.Generate(totp.GenerateOpts{Issuer: issuerName, AccountName: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	legacy := fmt.Sprintf(`{"enabled":true,"secret":%q}`, keyOTP.Secret())
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	m, err := New(dir, nil, key)
	if err != nil {
		t.Fatal(err)
	}
	users := m.ListUsers()
	if len(users) != 1 || users[0].Role != RoleAdmin || users[0].Username != "admin" {
		t.Fatalf("legacy config not migrated: %#v", users)
	}
	if _, err := m.Login("admin", newCode(t, keyOTP.Secret())); err != nil {
		t.Fatalf("login after migration: %v", err)
	}
}

func TestWrongMasterKeyFails(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{5}, 32)
	cipher, _ := config.NewCipher(key)
	m, _ := New(dir, cipher, key)
	secret, _, _, _ := m.BeginSetup()
	if _, err := m.ConfirmSetup(newCode(t, secret)); err != nil {
		t.Fatal(err)
	}

	otherKey := bytes.Repeat([]byte{6}, 32)
	otherCipher, _ := config.NewCipher(otherKey)
	if _, err := New(dir, otherCipher, otherKey); err == nil {
		t.Fatal("expected a decryption error with the wrong master key")
	}
}
