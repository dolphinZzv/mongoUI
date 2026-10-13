// Package auth adds TOTP (RFC 6238) authentication in front of the HTTP API.
// Multiple accounts are supported, each with a role: admin (full access and
// user management), readwrite (read + write data) or readonly (read only).
// Secrets are stored encrypted at rest with the same master key as the
// connection store.
package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"mongoui/internal/config"
)

const (
	cookieName = "mongoui_session"
	sessionTTL = 30 * 24 * time.Hour
	issuerName = "MongoUI"
)

// Role controls what an authenticated account may do.
type Role string

const (
	RoleAdmin     Role = "admin"
	RoleReadWrite Role = "readwrite"
	RoleReadOnly  Role = "readonly"
)

func validRole(role Role) bool {
	return role == RoleAdmin || role == RoleReadWrite || role == RoleReadOnly
}

// ErrInvalidCode is returned when a submitted TOTP code does not match.
var ErrInvalidCode = errors.New("invalid code")

// User is one TOTP account.
type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Secret    string `json:"secret"`
	Role      Role   `json:"role"`
	CreatedAt string `json:"createdAt"`
}

type storedConfig struct {
	Enabled bool   `json:"enabled"`
	Users   []User `json:"users,omitempty"`
	// Secret is the legacy single-account secret, migrated to Users on load.
	Secret string `json:"secret,omitempty"`
}

type pendingUser struct {
	username string
	role     Role
	secret   string
}

// Manager holds the accounts and the session signing key.
type Manager struct {
	mu         sync.Mutex
	path       string
	cipher     *config.Cipher
	sessionKey []byte
	enabled    bool
	users      []User
	pending    map[string]*pendingUser
}

// New loads (or prepares) the auth state under dataDir. masterKey derives the
// session signing key; cipher encrypts TOTP secrets at rest (both may be nil in
// tests).
func New(dataDir string, cipher *config.Cipher, masterKey []byte) (*Manager, error) {
	m := &Manager{
		path:    filepath.Join(dataDir, "auth.json"),
		cipher:  cipher,
		pending: map[string]*pendingUser{},
	}
	mac := hmac.New(sha256.New, masterKey)
	mac.Write([]byte("mongoui-session"))
	m.sessionKey = mac.Sum(nil)
	if err := m.load(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) decrypt(secret string) (string, error) {
	if m.cipher == nil || secret == "" {
		return secret, nil
	}
	return m.cipher.Decrypt(secret)
}

func (m *Manager) load() error {
	data, err := os.ReadFile(m.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var sc storedConfig
	if err := json.Unmarshal(data, &sc); err != nil {
		return err
	}
	for i := range sc.Users {
		if sc.Users[i].Secret, err = m.decrypt(sc.Users[i].Secret); err != nil {
			return err
		}
	}
	// Migrate the legacy single-account file to a users list.
	if len(sc.Users) == 0 && sc.Secret != "" {
		secret, err := m.decrypt(sc.Secret)
		if err != nil {
			return err
		}
		sc.Users = []User{{
			ID:        uuid.NewString(),
			Username:  "admin",
			Secret:    secret,
			Role:      RoleAdmin,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}}
	}
	m.users = sc.Users
	m.enabled = sc.Enabled && len(sc.Users) > 0
	return nil
}

// save writes the state. The caller must hold m.mu.
func (m *Manager) save() error {
	users := make([]User, len(m.users))
	copy(users, m.users)
	for i := range users {
		secret := users[i].Secret
		if m.cipher != nil {
			enc, err := m.cipher.Encrypt(secret)
			if err != nil {
				return err
			}
			secret = enc
		}
		users[i].Secret = secret
	}
	data, err := json.MarshalIndent(storedConfig{Enabled: m.enabled, Users: users}, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

// Enabled reports whether authentication has been configured.
func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

func (m *Manager) adminCount() int {
	count := 0
	for _, user := range m.users {
		if user.Role == RoleAdmin {
			count++
		}
	}
	return count
}

func (m *Manager) userByID(id string) (User, bool) {
	for _, user := range m.users {
		if user.ID == id {
			return user, true
		}
	}
	return User{}, false
}

func (m *Manager) defaultUserID() string {
	for _, user := range m.users {
		if user.Role == RoleAdmin {
			return user.ID
		}
	}
	if len(m.users) > 0 {
		return m.users[0].ID
	}
	return ""
}

// --- setup / login ----------------------------------------------------------

// BeginSetup generates the first (admin) account secret while auth is not yet
// configured.
func (m *Manager) BeginSetup() (secret, uri, qr string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.users) > 0 || m.enabled {
		return "", "", "", errors.New("authentication is already configured")
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuerName, AccountName: "admin"})
	if err != nil {
		return "", "", "", err
	}
	m.pending["initial"] = &pendingUser{username: "admin", role: RoleAdmin, secret: key.Secret()}
	if qr, err = qrDataURL(key); err != nil {
		return "", "", "", err
	}
	return key.Secret(), key.URL(), qr, nil
}

// ConfirmSetup validates the pending admin secret and enables authentication.
// It returns the new admin's id.
func (m *Manager) ConfirmSetup(code string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, ok := m.pending["initial"]
	if !ok {
		return "", errors.New("setup has not been started")
	}
	if !totp.Validate(strings.TrimSpace(code), pending.secret) {
		return "", ErrInvalidCode
	}
	user := User{
		ID:        uuid.NewString(),
		Username:  pending.username,
		Secret:    pending.secret,
		Role:      pending.role,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	m.users = append(m.users, user)
	delete(m.pending, "initial")
	m.enabled = true
	if err := m.save(); err != nil {
		return "", err
	}
	return user.ID, nil
}

// Login validates a username + TOTP code and returns the matching account.
func (m *Manager) Login(username, code string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.enabled || len(m.users) == 0 {
		return User{Username: "anonymous", Role: RoleAdmin}, nil
	}
	username = strings.TrimSpace(username)
	code = strings.TrimSpace(code)
	if username == "" && len(m.users) == 1 {
		username = m.users[0].Username
	}
	for _, user := range m.users {
		if user.Username != username {
			continue
		}
		if totp.Validate(code, user.Secret) {
			return user, nil
		}
		return User{}, ErrInvalidCode
	}
	return User{}, ErrInvalidCode
}

// --- user management --------------------------------------------------------

// ListUsers returns a copy of the accounts (secrets included; the HTTP handler
// strips them).
func (m *Manager) ListUsers() []User {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]User, len(m.users))
	copy(out, m.users)
	return out
}

// BeginUserSetup creates a pending account and returns its provisioning data.
func (m *Manager) BeginUserSetup(username string, role Role) (id, secret, uri, qr string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	username = strings.TrimSpace(username)
	if username == "" {
		return "", "", "", "", errors.New("username is required")
	}
	if !validRole(role) {
		return "", "", "", "", errors.New("invalid role")
	}
	for _, user := range m.users {
		if strings.EqualFold(user.Username, username) {
			return "", "", "", "", errors.New("username already exists")
		}
	}
	for _, pending := range m.pending {
		if strings.EqualFold(pending.username, username) {
			return "", "", "", "", errors.New("username already exists")
		}
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuerName, AccountName: username})
	if err != nil {
		return "", "", "", "", err
	}
	id = uuid.NewString()
	m.pending[id] = &pendingUser{username: username, role: role, secret: key.Secret()}
	if qr, err = qrDataURL(key); err != nil {
		return "", "", "", "", err
	}
	return id, key.Secret(), key.URL(), qr, nil
}

// ConfirmUserSetup validates the pending account's code and persists it.
func (m *Manager) ConfirmUserSetup(id, code string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, ok := m.pending[id]
	if !ok {
		return User{}, errors.New("no pending setup for this account")
	}
	if !totp.Validate(strings.TrimSpace(code), pending.secret) {
		return User{}, ErrInvalidCode
	}
	user := User{
		ID:        id,
		Username:  pending.username,
		Secret:    pending.secret,
		Role:      pending.role,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	m.users = append(m.users, user)
	delete(m.pending, id)
	if err := m.save(); err != nil {
		return User{}, err
	}
	return user, nil
}

// UpdateUserRole changes an account's role, keeping at least one admin.
func (m *Manager) UpdateUserRole(id string, role Role) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !validRole(role) {
		return errors.New("invalid role")
	}
	for i := range m.users {
		if m.users[i].ID != id {
			continue
		}
		if m.users[i].Role == RoleAdmin && role != RoleAdmin && m.adminCount() <= 1 {
			return errors.New("cannot remove the last admin")
		}
		m.users[i].Role = role
		return m.save()
	}
	return errors.New("account not found")
}

// DeleteUser removes an account, keeping at least one admin.
func (m *Manager) DeleteUser(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if m.users[i].ID != id {
			continue
		}
		if m.users[i].Role == RoleAdmin && m.adminCount() <= 1 {
			return errors.New("cannot delete the last admin")
		}
		m.users = append(m.users[:i], m.users[i+1:]...)
		return m.save()
	}
	return errors.New("account not found")
}

func qrDataURL(key *otp.Key) (string, error) {
	img, err := key.Image(240, 240)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// --- sessions ---------------------------------------------------------------

func (m *Manager) newSession(userID string) string {
	payload := strconv.FormatInt(time.Now().Add(sessionTTL).Unix(), 10) + "\n" + userID
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// validSession verifies a token and returns the account id. Legacy tokens that
// only carry an expiry are attributed to the default admin so existing sessions
// survive the upgrade.
func (m *Manager) validSession(token string) (string, bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", false
	}
	expiryText, userID, _ := strings.Cut(string(payload), "\n")
	expiry, err := strconv.ParseInt(expiryText, 10, 64)
	if err != nil || time.Now().Unix() >= expiry {
		return "", false
	}
	if userID == "" {
		m.mu.Lock()
		userID = m.defaultUserID()
		m.mu.Unlock()
	}
	if userID == "" {
		return "", false
	}
	return userID, true
}

func (m *Manager) authenticated(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return "", false
	}
	return m.validSession(cookie.Value)
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		MaxAge:   int(sessionTTL.Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

// --- authorization helpers --------------------------------------------------

// Role returns the caller's role. When auth is disabled every caller is an
// admin; when it is enabled an unauthenticated caller reports ok=false.
func (m *Manager) Role(r *http.Request) (Role, bool) {
	if !m.Enabled() {
		return RoleAdmin, true
	}
	id, ok := m.authenticated(r)
	if !ok {
		return "", false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if user, found := m.userByID(id); found {
		return user.Role, true
	}
	return "", false
}

// CanWrite reports whether the caller may modify data.
func (m *Manager) CanWrite(r *http.Request) bool {
	role, ok := m.Role(r)
	return ok && role != RoleReadOnly
}

// IsAdmin reports whether the caller may manage accounts.
func (m *Manager) IsAdmin(r *http.Request) bool {
	if !m.Enabled() {
		return true
	}
	role, ok := m.Role(r)
	return ok && role == RoleAdmin
}

// Current returns the authenticated account, if any.
func (m *Manager) Current(r *http.Request) (User, bool) {
	if !m.Enabled() {
		return User{Username: "anonymous", Role: RoleAdmin}, true
	}
	id, ok := m.authenticated(r)
	if !ok {
		return User{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.userByID(id)
}

// Middleware rejects unauthenticated API requests once auth is enabled.
func (m *Manager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.Enabled() {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := m.authenticated(r); ok {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"authentication required"}`))
	})
}

// --- HTTP endpoints ---------------------------------------------------------

// Routes returns the /api/auth endpoints.
func (m *Manager) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/status", m.handleStatus)
	r.Post("/setup/begin", m.handleSetupBegin)
	r.Post("/setup/confirm", m.handleSetupConfirm)
	r.Post("/login", m.handleLogin)
	r.Post("/logout", m.handleLogout)

	r.Get("/users", m.handleListUsers)
	r.Post("/users", m.handleCreateUser)
	r.Post("/users/{id}/confirm", m.handleConfirmUser)
	r.Patch("/users/{id}", m.handleUpdateUser)
	r.Delete("/users/{id}", m.handleDeleteUser)
	return r
}

type codeRequest struct {
	Code string `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func (m *Manager) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if m.IsAdmin(r) {
		return true
	}
	fail(w, http.StatusForbidden, errors.New("admin access required"))
	return false
}

func (m *Manager) handleStatus(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"enabled":       m.Enabled(),
		"authenticated": false,
		"needsSetup":    !m.Enabled(),
	}
	if m.Enabled() {
		if user, ok := m.Current(r); ok {
			data["authenticated"] = true
			data["username"] = user.Username
			data["role"] = user.Role
		}
	}
	ok(w, data)
}

func (m *Manager) handleSetupBegin(w http.ResponseWriter, _ *http.Request) {
	secret, uri, qr, err := m.BeginSetup()
	if err != nil {
		fail(w, http.StatusConflict, err)
		return
	}
	ok(w, map[string]any{"secret": secret, "otpauthUrl": uri, "qr": qr})
}

func (m *Manager) handleSetupConfirm(w http.ResponseWriter, r *http.Request) {
	var req codeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	id, err := m.ConfirmSetup(req.Code)
	if err != nil {
		if errors.Is(err, ErrInvalidCode) {
			fail(w, http.StatusUnauthorized, err)
			return
		}
		fail(w, http.StatusBadRequest, err)
		return
	}
	setSessionCookie(w, r, m.newSession(id))
	ok(w, map[string]any{"enabled": true, "username": "admin", "role": RoleAdmin})
}

func (m *Manager) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	user, err := m.Login(req.Username, req.Code)
	if err != nil {
		fail(w, http.StatusUnauthorized, err)
		return
	}
	setSessionCookie(w, r, m.newSession(user.ID))
	ok(w, map[string]any{
		"authenticated": true,
		"username":      user.Username,
		"role":          user.Role,
	})
}

func (m *Manager) handleLogout(w http.ResponseWriter, _ *http.Request) {
	clearSessionCookie(w)
	ok(w, map[string]any{"authenticated": false})
}

func (m *Manager) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	users := m.ListUsers()
	out := make([]map[string]any, 0, len(users))
	for _, user := range users {
		out = append(out, map[string]any{
			"id":        user.ID,
			"username":  user.Username,
			"role":      user.Role,
			"createdAt": user.CreatedAt,
		})
	}
	ok(w, out)
}

func (m *Manager) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	var req struct {
		Username string `json:"username"`
		Role     Role   `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	id, secret, uri, qr, err := m.BeginUserSetup(req.Username, req.Role)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"id": id, "secret": secret, "otpauthUrl": uri, "qr": qr})
}

func (m *Manager) handleConfirmUser(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	var req codeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	user, err := m.ConfirmUserSetup(chi.URLParam(r, "id"), req.Code)
	if err != nil {
		if errors.Is(err, ErrInvalidCode) {
			fail(w, http.StatusUnauthorized, err)
			return
		}
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"id": user.ID, "username": user.Username, "role": user.Role})
}

func (m *Manager) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	var req struct {
		Role Role `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if err := m.UpdateUserRole(chi.URLParam(r, "id"), req.Role); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"id": chi.URLParam(r, "id"), "role": req.Role})
}

func (m *Manager) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	if err := m.DeleteUser(chi.URLParam(r, "id")); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"deleted": chi.URLParam(r, "id")})
}
