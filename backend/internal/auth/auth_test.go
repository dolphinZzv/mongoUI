package auth

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
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

func requestWithToken(token string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
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

func TestListUsersReturnsAllAccountsAndNoStore(t *testing.T) {
	m := newTestManager(t)
	secret, _, _, _ := m.BeginSetup()
	adminID, err := m.ConfirmSetup(newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alice", "bob"} {
		id, secret, _, _, err := m.BeginUserSetup(name, RoleReadWrite)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := m.ConfirmUserSetup(id, newCode(t, secret)); err != nil {
			t.Fatal(err)
		}
	}

	rec := httptest.NewRecorder()
	m.handleListUsers(rec, requestWithSession(m, adminID))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	for _, name := range []string{"admin", "alice", "bob"} {
		if !strings.Contains(rec.Body.String(), `"username":"`+name+`"`) {
			t.Fatalf("account %q missing from %s", name, rec.Body.String())
		}
	}
}

func TestPasswordSetupAndLogin(t *testing.T) {
	m := newTestManager(t)
	if _, err := m.SetupWithPassword("admin", "short"); err == nil {
		t.Fatal("expected a short password to be rejected")
	}
	user, err := m.SetupWithPassword("admin", "correct horse battery")
	if err != nil {
		t.Fatalf("password setup: %v", err)
	}
	if !m.Enabled() {
		t.Fatal("password setup should enable authentication")
	}
	if _, err := m.SetupWithPassword("other", "another good password"); err == nil {
		t.Fatal("expected a second setup to be rejected")
	}
	password, totpEnabled := m.Methods()
	if !password || totpEnabled {
		t.Fatalf("methods = password:%v totp:%v", password, totpEnabled)
	}
	if _, err := m.LoginPassword(user.Username, "wrong password"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("wrong password error = %v", err)
	}
	loggedIn, err := m.LoginPassword(user.Username, "correct horse battery")
	if err != nil {
		t.Fatalf("password login: %v", err)
	}
	if loggedIn.ID != user.ID || loggedIn.Role != RoleAdmin {
		t.Fatalf("unexpected login result: %#v", loggedIn)
	}
	if _, err := m.Login(user.Username, "000000"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("password-only account accepted a TOTP code: %v", err)
	}
}

func TestPasswordUserCreationAndChange(t *testing.T) {
	m := newTestManager(t)
	admin, err := m.SetupWithPassword("admin", "initial admin password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := m.CreatePasswordUser("alice", RoleReadWrite, "alice password")
	if err != nil {
		t.Fatalf("create password user: %v", err)
	}
	if user.PasswordHash == "" || strings.Contains(user.PasswordHash, "alice password") {
		t.Fatal("password was not hashed")
	}
	if _, err := m.CreatePasswordUser("Alice", RoleReadOnly, "another password"); err == nil {
		t.Fatal("expected duplicate usernames to be rejected case-insensitively")
	}
	if _, err := m.LoginPassword("alice", "alice password"); err != nil {
		t.Fatalf("new user login: %v", err)
	}
	if err := m.ChangePassword(user.ID, "wrong current", "new alice password"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("wrong current password error = %v", err)
	}
	if err := m.ChangePassword(user.ID, "alice password", "new alice password"); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := m.LoginPassword("alice", "alice password"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatal("old password still accepted")
	}
	if _, err := m.LoginPassword("alice", "new alice password"); err != nil {
		t.Fatalf("new password rejected: %v", err)
	}
	if err := m.SetUserPassword(admin.ID, "reset admin password"); err != nil {
		t.Fatalf("admin password reset: %v", err)
	}
}

func TestPasswordPersistenceIsEncrypted(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{9}, 32)
	cipher, err := config.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(dir, cipher, key)
	if err != nil {
		t.Fatal(err)
	}
	password := "a very secret password"
	if _, err := m.SetupWithPassword("admin", password); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), password) || strings.Contains(string(raw), "$2a$") {
		t.Fatal("password material stored in plaintext")
	}
	reloaded, err := New(dir, cipher, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reloaded.LoginPassword("admin", password); err != nil {
		t.Fatalf("login after reload: %v", err)
	}
}

func TestPersonalAccessTokenScopes(t *testing.T) {
	m := newTestManager(t)
	admin, err := m.SetupWithPassword("admin", "admin password")
	if err != nil {
		t.Fatal(err)
	}
	id, secret, _, _, err := m.BeginUserSetup("writer", RoleReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := m.ConfirmUserSetup(id, newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}

	readRaw, readToken, err := m.CreateToken(writer.ID, "read only", []string{ScopeRead}, "")
	if err != nil {
		t.Fatalf("create read token: %v", err)
	}
	if len(readToken.Scopes) != 1 || readToken.Scopes[0] != ScopeRead {
		t.Fatalf("read scopes = %#v", readToken.Scopes)
	}
	readReq := requestWithToken(readRaw)
	if _, ok := m.Current(readReq); !ok {
		t.Fatal("read token not authenticated")
	}
	if scopes, ok := m.TokenScopes(readReq); !ok || len(scopes) != 1 || scopes[0] != ScopeRead {
		t.Fatalf("TokenScopes(read) = %#v, %v", scopes, ok)
	}
	if _, ok := m.TokenScopes(requestWithSession(m, writer.ID)); ok {
		t.Fatal("TokenScopes must not accept a browser session")
	}
	if m.CanWrite(readReq) {
		t.Fatal("read token should not be able to write")
	}
	if m.IsAdmin(readReq) {
		t.Fatal("read token should not be admin")
	}

	writeRaw, writeToken, err := m.CreateToken(writer.ID, "write", []string{ScopeWrite}, "")
	if err != nil {
		t.Fatalf("create write token: %v", err)
	}
	if !m.CanWrite(requestWithToken(writeRaw)) {
		t.Fatal("write token should be able to write")
	}
	if m.IsAdmin(requestWithToken(writeRaw)) {
		t.Fatal("write token should not be admin")
	}

	adminRaw, adminToken, err := m.CreateToken(admin.ID, "admin", []string{ScopeAdmin}, "")
	if err != nil {
		t.Fatalf("create admin token: %v", err)
	}
	if !m.IsAdmin(requestWithToken(adminRaw)) {
		t.Fatal("admin token should be admin")
	}

	if _, _, err := m.CreateToken(writer.ID, "escalate", []string{ScopeAdmin}, ""); err == nil {
		t.Fatal("expected a readwrite account to be unable to create an admin token")
	}

	list := m.ListTokens(writer.ID)
	if len(list) != 2 {
		t.Fatalf("token list = %#v", list)
	}
	for _, token := range list {
		if token.Hash != "" {
			t.Fatal("token hash leaked in list")
		}
	}
	if strings.Contains(fmt.Sprint(list), readRaw) || strings.Contains(fmt.Sprint(list), writeRaw) {
		t.Fatal("raw token leaked in list")
	}

	guarded := m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	guarded.ServeHTTP(rec, requestWithToken(readRaw))
	if rec.Code != http.StatusOK {
		t.Fatalf("token middleware = %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, requestWithToken("moui_pat_invalid"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token middleware = %d", rec.Code)
	}

	// Personal access tokens cannot mint or list other tokens.
	rec = httptest.NewRecorder()
	m.handleListTokens(rec, requestWithToken(readRaw))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("token-authenticated token listing = %d, want 401", rec.Code)
	}

	if err := m.DeleteToken(writer.ID, readToken.ID); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	guarded.ServeHTTP(rec, requestWithToken(readRaw))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted token middleware = %d", rec.Code)
	}
	if err := m.DeleteToken(writer.ID, writeToken.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteToken(admin.ID, adminToken.ID); err != nil {
		t.Fatal(err)
	}
}

func TestTokenDemotionLimitsEffectiveScopes(t *testing.T) {
	m := newTestManager(t)
	admin, err := m.SetupWithPassword("admin", "admin password")
	if err != nil {
		t.Fatal(err)
	}
	id, secret, _, _, err := m.BeginUserSetup("admin2", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.ConfirmUserSetup(id, newCode(t, secret))
	if err != nil {
		t.Fatal(err)
	}
	raw, _, err := m.CreateToken(second.ID, "admin token", []string{ScopeAdmin}, "")
	if err != nil {
		t.Fatal(err)
	}
	req := requestWithToken(raw)
	if !m.IsAdmin(req) {
		t.Fatal("admin token should start with admin access")
	}
	if err := m.UpdateUserRole(second.ID, RoleReadOnly); err != nil {
		t.Fatal(err)
	}
	if m.IsAdmin(req) || m.CanWrite(req) {
		t.Fatal("demoted account token retained elevated access")
	}
	if role, ok := m.Role(req); !ok || role != RoleReadOnly {
		t.Fatalf("demoted role = %q ok=%v", role, ok)
	}
	if admin.ID == second.ID {
		t.Fatal("unexpected admin id collision")
	}
}

func TestLoginGuardLocksAndExpires(t *testing.T) {
	g := newLoginGuard()
	now := time.Now()
	for i := 0; i < loginMaxFailures; i++ {
		if retry, ok := g.allow("admin|127.0.0.1", now); !ok {
			t.Fatalf("attempt %d unexpectedly blocked for %s", i, retry)
		}
		g.fail("admin|127.0.0.1", now, loginMaxFailures)
	}
	if retry, ok := g.allow("admin|127.0.0.1", now); ok || retry <= 0 {
		t.Fatalf("expected lockout, got ok=%v retry=%s", ok, retry)
	}
	if _, ok := g.allow("admin|127.0.0.1", now.Add(loginLockout+time.Second)); !ok {
		t.Fatal("lockout should expire")
	}
	g.succeed("admin|127.0.0.1")
	if _, ok := g.allow("admin|127.0.0.1", now.Add(loginLockout+2*time.Second)); !ok {
		t.Fatal("success should reset the guard")
	}
}

func TestLoginHandlerRateLimit(t *testing.T) {
	m := newTestManager(t)
	if _, err := m.SetupWithPassword("admin", "correct horse battery"); err != nil {
		t.Fatal(err)
	}
	body := `{"username":"admin","password":"wrong password","method":"password"}`
	for i := 0; i < loginMaxFailures; i++ {
		rec := httptest.NewRecorder()
		m.handleLogin(rec, httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body)))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", i, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	m.handleLogin(rec, httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body)))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("blocked login status = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}
}

func TestPasswordChangeRevokesOldSessions(t *testing.T) {
	m := newTestManager(t)
	user, err := m.SetupWithPassword("admin", "initial password")
	if err != nil {
		t.Fatal(err)
	}
	oldToken := m.newSession(user.ID)
	if _, ok := m.validSession(oldToken); !ok {
		t.Fatal("initial session should be valid")
	}
	if err := m.ChangePassword(user.ID, "initial password", "new password"); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.validSession(oldToken); ok {
		t.Fatal("old session survived a password change")
	}
	if _, ok := m.validSession(m.newSession(user.ID)); !ok {
		t.Fatal("new session should be valid after password change")
	}
	if err := m.SetUserPassword(user.ID, "admin reset password"); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.validSession(m.newSession(user.ID)); !ok {
		t.Fatal("new session should be valid after admin reset")
	}
}

func TestRevokeSessions(t *testing.T) {
	m := newTestManager(t)
	user, err := m.SetupWithPassword("admin", "initial password")
	if err != nil {
		t.Fatal(err)
	}
	token := m.newSession(user.ID)
	if err := m.RevokeSessions(user.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.validSession(token); ok {
		t.Fatal("session survived RevokeSessions")
	}
}

func TestAuditActor(t *testing.T) {
	m := newTestManager(t)
	user, err := m.SetupWithPassword("admin", "initial password")
	if err != nil {
		t.Fatal(err)
	}
	username, tokenID := m.AuditActor(requestWithSession(m, user.ID))
	if username != "admin" || tokenID != "" {
		t.Fatalf("session actor = %q/%q", username, tokenID)
	}
	raw, token, err := m.CreateToken(user.ID, "audit", []string{ScopeRead}, "")
	if err != nil {
		t.Fatal(err)
	}
	username, tokenID = m.AuditActor(requestWithToken(raw))
	if username != "admin" || tokenID != token.ID {
		t.Fatalf("token actor = %q/%q, want admin/%s", username, tokenID, token.ID)
	}
}

func TestChangePasswordHandlerRefreshesCookieAndRevokesOldToken(t *testing.T) {
	m := newTestManager(t)
	user, err := m.SetupWithPassword("admin", "initial password")
	if err != nil {
		t.Fatal(err)
	}
	oldToken := m.newSession(user.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password", strings.NewReader(
		`{"currentPassword":"initial password","newPassword":"new password"}`,
	))
	req.AddCookie(&http.Cookie{Name: cookieName, Value: oldToken})
	rec := httptest.NewRecorder()
	m.handleChangePassword(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var fresh string
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == cookieName {
			fresh = cookie.Value
		}
	}
	if fresh == "" {
		t.Fatal("password change did not refresh the session cookie")
	}
	if _, ok := m.validSession(oldToken); ok {
		t.Fatal("old token survived password change")
	}
	if _, ok := m.validSession(fresh); !ok {
		t.Fatal("fresh token is invalid")
	}
}

func TestLogoutAllRevokesSessions(t *testing.T) {
	m := newTestManager(t)
	user, err := m.SetupWithPassword("admin", "initial password")
	if err != nil {
		t.Fatal(err)
	}
	token := m.newSession(user.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", strings.NewReader(`{"all":true}`))
	req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	rec := httptest.NewRecorder()
	m.handleLogout(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if _, ok := m.validSession(token); ok {
		t.Fatal("logout all left the old session valid")
	}
}

func TestConnectionAllowlist(t *testing.T) {
	m := newTestManager(t)
	admin, err := m.SetupWithPassword("admin", "admin password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := m.CreatePasswordUser("alice", RoleReadWrite, "alice password")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.UpdateUserConnections(user.ID, []string{" c1 ", "c2", "c1", ""}); err != nil {
		t.Fatal(err)
	}
	req := requestWithSession(m, user.ID)
	if !m.CanAccessConnection(req, "c1") || !m.CanAccessConnection(req, "c2") {
		t.Fatal("allowed connection denied")
	}
	if m.CanAccessConnection(req, "c3") || m.CanWriteConnection(req, "c3") {
		t.Fatal("disallowed connection granted")
	}
	if !m.CanWriteConnection(req, "c1") {
		t.Fatal("readwrite account should write on an allowed connection")
	}

	raw, token, err := m.CreateToken(user.ID, "restricted", []string{ScopeRead}, "")
	if err != nil {
		t.Fatal(err)
	}
	ids, ok := m.TokenConnectionIDs(requestWithToken(raw))
	if !ok || len(ids) != 2 || ids[0] != "c1" || ids[1] != "c2" {
		t.Fatalf("token connection ids = %#v, %v", ids, ok)
	}
	if _, ok := m.TokenConnectionIDs(requestWithSession(m, user.ID)); ok {
		t.Fatal("TokenConnectionIDs must not accept a session cookie")
	}

	// Admin is unrestricted even with a stored allowlist.
	if err := m.UpdateUserConnections(admin.ID, []string{"c1"}); err != nil {
		t.Fatal(err)
	}
	if !m.CanAccessConnection(requestWithSession(m, admin.ID), "c9") {
		t.Fatal("admin should bypass the allowlist")
	}
	if token.ID == "" {
		t.Fatal("unexpected empty token id")
	}
}

func TestUpdateUserConnectionsHandler(t *testing.T) {
	m := newTestManager(t)
	admin, err := m.SetupWithPassword("admin", "admin password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := m.CreatePasswordUser("alice", RoleReadWrite, "alice password")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPatch, "/users/"+user.ID,
		strings.NewReader(`{"connectionIds":["c1","c1"," c2 "]}`))
	req.AddCookie(&http.Cookie{Name: cookieName, Value: m.newSession(admin.ID)})
	rec := httptest.NewRecorder()
	router := chi.NewRouter()
	router.Patch("/users/{id}", m.handleUpdateUser)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	for _, candidate := range m.ListUsers() {
		if candidate.ID != user.ID {
			continue
		}
		if len(candidate.ConnectionIDs) != 2 ||
			candidate.ConnectionIDs[0] != "c1" || candidate.ConnectionIDs[1] != "c2" {
			t.Fatalf("connectionIds = %#v", candidate.ConnectionIDs)
		}
		return
	}
	t.Fatal("updated account not found")
}
