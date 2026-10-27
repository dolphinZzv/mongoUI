// Package auth adds account authentication in front of the HTTP API. Local
// accounts can sign in with a password and/or TOTP (RFC 6238); OIDC accounts
// are provisioned by single sign-on. Multiple accounts are supported, each with
// a role: admin (full access and user management), readwrite (read + write
// data) or readonly (read only). Personal access tokens (PATs) allow scoped API
// access, and secrets are stored encrypted at rest with the same master key as
// the connection store.
package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
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
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"

	"mongoui/internal/config"
	"mongoui/internal/oidc"
)

const (
	cookieName = "mongoui_session"
	sessionTTL = 30 * 24 * time.Hour
	issuerName = "MongoUI"

	// MinPasswordLength and MaxPasswordBytes bound local account passwords.
	// bcrypt only considers the first 72 bytes, so longer inputs are rejected
	// instead of being silently truncated.
	MinPasswordLength = 8
	MaxPasswordBytes  = 72

	tokenMarker = "moui_pat_"

	// ScopeRead grants read-only API access, ScopeWrite adds data mutations and
	// ScopeAdmin allows server-wide administration. Tokens never grant more
	// than the account's current role.
	ScopeRead  = "read"
	ScopeWrite = "write"
	ScopeAdmin = "admin"
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

func validatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return errors.New("password must be at least 8 characters")
	}
	if len(password) > MaxPasswordBytes {
		return errors.New("password must be at most 72 bytes")
	}
	return nil
}

func hashPassword(password string) (string, error) {
	if err := validatePassword(password); err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func normalizeScopes(scopes []string) ([]string, error) {
	seen := map[string]bool{}
	for _, scope := range scopes {
		scope = strings.ToLower(strings.TrimSpace(scope))
		switch scope {
		case "":
			continue
		case ScopeRead, ScopeWrite, ScopeAdmin:
			seen[scope] = true
		default:
			return nil, errors.New("invalid scope: " + scope)
		}
	}
	if len(seen) == 0 {
		return nil, errors.New("at least one scope is required")
	}
	// Write and admin imply read; admin implies write. This keeps scope checks
	// simple and prevents a token that can mutate data but cannot read it.
	if seen[ScopeAdmin] {
		seen[ScopeWrite] = true
	}
	if seen[ScopeWrite] {
		seen[ScopeRead] = true
	}
	out := make([]string, 0, 3)
	for _, scope := range []string{ScopeRead, ScopeWrite, ScopeAdmin} {
		if seen[scope] {
			out = append(out, scope)
		}
	}
	return out, nil
}

func scopesAllowedForRole(role Role, scopes []string) bool {
	has := func(scope string) bool {
		for _, item := range scopes {
			if item == scope {
				return true
			}
		}
		return false
	}
	switch role {
	case RoleAdmin:
		return true
	case RoleReadWrite:
		return !has(ScopeAdmin)
	case RoleReadOnly:
		return !has(ScopeWrite) && !has(ScopeAdmin)
	default:
		return false
	}
}

// roleScopes returns the maximum scopes implied by a role.
func roleScopes(role Role) []string {
	switch role {
	case RoleAdmin:
		return []string{ScopeRead, ScopeWrite, ScopeAdmin}
	case RoleReadWrite:
		return []string{ScopeRead, ScopeWrite}
	case RoleReadOnly:
		return []string{ScopeRead}
	default:
		return nil
	}
}

// effectiveScopes intersects requested token scopes with what the account's
// current role allows, so a demoted account cannot keep elevated token rights.
func effectiveScopes(role Role, scopes []string) []string {
	allowed := map[string]bool{}
	for _, scope := range roleScopes(role) {
		allowed[scope] = true
	}
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		if allowed[scope] {
			out = append(out, scope)
		}
	}
	return out
}

func hasScope(scopes []string, scope string) bool {
	for _, item := range scopes {
		if item == scope {
			return true
		}
	}
	return false
}

// userSource reports how an account was created. A local account is labelled
// "password" when it has no TOTP secret.
func userSource(user User) string {
	if strings.TrimSpace(user.Source) != "" {
		return user.Source
	}
	if user.Secret != "" {
		return "totp"
	}
	if user.PasswordHash != "" {
		return "password"
	}
	return "totp"
}

// ErrInvalidCode is returned when a submitted TOTP code does not match.
var ErrInvalidCode = errors.New("invalid code")

// ErrInvalidPassword is deliberately generic to avoid leaking which usernames
// exist.
var ErrInvalidPassword = errors.New("invalid username or password")

var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("mongoui-invalid-password"), bcrypt.DefaultCost)

// Token is a personal access token. Only the SHA-256 hash is persisted; the raw
// token is returned exactly once when it is created.
type Token struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Prefix     string   `json:"prefix"`
	Hash       string   `json:"hash,omitempty"`
	Scopes     []string `json:"scopes"`
	CreatedAt  string   `json:"createdAt"`
	LastUsedAt string   `json:"lastUsedAt,omitempty"`
	ExpiresAt  string   `json:"expiresAt,omitempty"`
}

// User is one account. Source is "totp"/"password" (default local account) or
// "oidc" for accounts provisioned through single sign-on. Local accounts may
// have both a TOTP secret and a password.
type User struct {
	ID           string  `json:"id"`
	Username     string  `json:"username"`
	Secret       string  `json:"secret,omitempty"`
	PasswordHash string  `json:"passwordHash,omitempty"`
	Role         Role    `json:"role"`
	CreatedAt    string  `json:"createdAt"`
	Source       string  `json:"source,omitempty"`
	Email        string  `json:"email,omitempty"`
	Tokens       []Token `json:"tokens,omitempty"`
}

type storedConfig struct {
	Enabled bool   `json:"enabled"`
	Users   []User `json:"users,omitempty"`
	// Secret is the legacy single-account secret, migrated to Users on load.
	Secret string      `json:"secret,omitempty"`
	OIDC   *OIDCConfig `json:"oidc,omitempty"`
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
	// oidc is the decrypted single sign-on configuration, if any.
	oidc *OIDCConfig

	oidcMu       sync.Mutex
	oidcProvider *oidc.Provider
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
		if sc.Users[i].PasswordHash, err = m.decrypt(sc.Users[i].PasswordHash); err != nil {
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
	if sc.OIDC != nil {
		if sc.OIDC.ClientSecret, err = m.decrypt(sc.OIDC.ClientSecret); err != nil {
			return err
		}
	}
	m.users = sc.Users
	m.oidc = sc.OIDC
	m.enabled = sc.Enabled && len(sc.Users) > 0
	return nil
}

// save writes the state. The caller must hold m.mu.
func (m *Manager) save() error {
	users := make([]User, len(m.users))
	copy(users, m.users)
	for i := range users {
		if m.cipher != nil {
			enc, err := m.cipher.Encrypt(users[i].Secret)
			if err != nil {
				return err
			}
			users[i].Secret = enc
			enc, err = m.cipher.Encrypt(users[i].PasswordHash)
			if err != nil {
				return err
			}
			users[i].PasswordHash = enc
		}
	}
	oidcCfg, err := oidcToStore(m.oidc, m.cipher)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(storedConfig{Enabled: m.enabled, Users: users, OIDC: oidcCfg}, "", "  ")
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
		// Keep memory consistent with disk so a failed write does not leave a
		// half-created account that disappears on the next restart.
		m.users = m.users[:len(m.users)-1]
		m.enabled = false
		m.pending["initial"] = pending
		return "", err
	}
	return user.ID, nil
}

// SetupWithPassword creates the first (admin) account using a password. It is
// an alternative to the TOTP setup flow and enables authentication immediately.
func (m *Manager) SetupWithPassword(username, password string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		username = "admin"
	}
	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.users) > 0 || m.enabled {
		return User{}, errors.New("authentication is already configured")
	}
	user := User{
		ID:           uuid.NewString(),
		Username:     username,
		PasswordHash: hash,
		Role:         RoleAdmin,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	m.users = append(m.users, user)
	delete(m.pending, "initial")
	m.enabled = true
	if err := m.save(); err != nil {
		m.users = m.users[:len(m.users)-1]
		m.enabled = false
		return User{}, err
	}
	return user, nil
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
		// OIDC accounts have no TOTP secret and cannot log in here.
		if user.Secret == "" {
			return User{}, ErrInvalidCode
		}
		if totp.Validate(code, user.Secret) {
			return user, nil
		}
		return User{}, ErrInvalidCode
	}
	return User{}, ErrInvalidCode
}

// LoginPassword validates a username + password and returns the matching
// account. The bcrypt comparison runs outside the manager lock so a slow login
// cannot block other requests.
func (m *Manager) LoginPassword(username, password string) (User, error) {
	m.mu.Lock()
	if !m.enabled || len(m.users) == 0 {
		m.mu.Unlock()
		return User{Username: "anonymous", Role: RoleAdmin}, nil
	}
	username = strings.TrimSpace(username)
	if username == "" && len(m.users) == 1 {
		username = m.users[0].Username
	}
	var user User
	found := false
	for _, candidate := range m.users {
		if candidate.Username == username && candidate.Source != "oidc" {
			user = candidate
			found = true
			break
		}
	}
	m.mu.Unlock()

	if !found || user.PasswordHash == "" {
		// Spend roughly the same time as a real comparison so the response does
		// not reveal whether the username exists.
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return User{}, ErrInvalidPassword
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return User{}, ErrInvalidPassword
	}
	return user, nil
}

// Methods reports which local sign-in methods are available.
func (m *Manager) Methods() (password, totp bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.enabled {
		return false, false
	}
	for _, user := range m.users {
		if user.Source == "oidc" {
			continue
		}
		if user.PasswordHash != "" {
			password = true
		}
		if user.Secret != "" {
			totp = true
		}
	}
	return password, totp
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

// CreatePasswordUser creates an active local account with a password.
func (m *Manager) CreatePasswordUser(username string, role Role, password string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return User{}, errors.New("username is required")
	}
	if !validRole(role) {
		return User{}, errors.New("invalid role")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, user := range m.users {
		if strings.EqualFold(user.Username, username) {
			return User{}, errors.New("username already exists")
		}
	}
	for _, pending := range m.pending {
		if strings.EqualFold(pending.username, username) {
			return User{}, errors.New("username already exists")
		}
	}
	user := User{
		ID:           uuid.NewString(),
		Username:     username,
		PasswordHash: hash,
		Role:         role,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	m.users = append(m.users, user)
	if err := m.save(); err != nil {
		m.users = m.users[:len(m.users)-1]
		return User{}, err
	}
	return user, nil
}

// SetUserPassword sets or resets a local account's password. It is used by
// admins and does not require the current password.
func (m *Manager) SetUserPassword(id, password string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if m.users[i].ID != id {
			continue
		}
		if m.users[i].Source == "oidc" {
			return errors.New("OIDC accounts cannot use password login")
		}
		old := m.users[i].PasswordHash
		m.users[i].PasswordHash = hash
		if err := m.save(); err != nil {
			m.users[i].PasswordHash = old
			return err
		}
		return nil
	}
	return errors.New("account not found")
}

// ChangePassword updates the caller's own password. When a password already
// exists the current one must match; a session alone is enough to add a first
// password to a TOTP-only account.
func (m *Manager) ChangePassword(id, current, next string) error {
	hash, err := hashPassword(next)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if m.users[i].ID != id {
			continue
		}
		if m.users[i].Source == "oidc" {
			return errors.New("OIDC accounts cannot use password login")
		}
		if m.users[i].PasswordHash != "" {
			if bcrypt.CompareHashAndPassword([]byte(m.users[i].PasswordHash), []byte(current)) != nil {
				return ErrInvalidPassword
			}
		}
		old := m.users[i].PasswordHash
		m.users[i].PasswordHash = hash
		if err := m.save(); err != nil {
			m.users[i].PasswordHash = old
			return err
		}
		return nil
	}
	return errors.New("account not found")
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
		// Roll back the in-memory append when persistence fails; otherwise the
		// account appears in the list until the next restart, then vanishes.
		m.users = m.users[:len(m.users)-1]
		m.pending[id] = pending
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
		oldRole := m.users[i].Role
		m.users[i].Role = role
		if err := m.save(); err != nil {
			m.users[i].Role = oldRole
			return err
		}
		return nil
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
		removed := m.users[i]
		m.users = append(m.users[:i], m.users[i+1:]...)
		if err := m.save(); err != nil {
			// Put the account back so memory still matches the on-disk state.
			m.users = append(m.users, User{})
			copy(m.users[i+1:], m.users[i:])
			m.users[i] = removed
			return err
		}
		return nil
	}
	return errors.New("account not found")
}

// --- personal access tokens -------------------------------------------------

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// CreateToken issues a scoped personal access token. The raw token is returned
// only from this call; only its hash is stored.
func (m *Manager) CreateToken(userID, name string, scopes []string, expiresAt string) (string, Token, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", Token{}, errors.New("token name is required")
	}
	normalized, err := normalizeScopes(scopes)
	if err != nil {
		return "", Token{}, err
	}
	if expiresAt != "" {
		expiry, err := time.Parse(time.RFC3339, expiresAt)
		if err != nil {
			return "", Token{}, errors.New("expiresAt must be an RFC3339 timestamp")
		}
		if !expiry.After(time.Now()) {
			return "", Token{}, errors.New("expiresAt must be in the future")
		}
		expiresAt = expiry.UTC().Format(time.RFC3339)
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", Token{}, err
	}
	raw := tokenMarker + base64.RawURLEncoding.EncodeToString(buf)
	prefixLen := len(tokenMarker) + 8
	if prefixLen > len(raw) {
		prefixLen = len(raw)
	}
	token := Token{
		ID:        uuid.NewString(),
		Name:      name,
		Prefix:    raw[:prefixLen],
		Hash:      hashToken(raw),
		Scopes:    normalized,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		ExpiresAt: expiresAt,
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if m.users[i].ID != userID {
			continue
		}
		if !scopesAllowedForRole(m.users[i].Role, normalized) {
			return "", Token{}, errors.New("scopes exceed the account role")
		}
		m.users[i].Tokens = append(m.users[i].Tokens, token)
		if err := m.save(); err != nil {
			m.users[i].Tokens = m.users[i].Tokens[:len(m.users[i].Tokens)-1]
			return "", Token{}, err
		}
		return raw, token, nil
	}
	return "", Token{}, errors.New("account not found")
}

// ListTokens returns a user's tokens without hashes or raw secrets.
func (m *Manager) ListTokens(userID string) []Token {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, user := range m.users {
		if user.ID != userID {
			continue
		}
		out := make([]Token, len(user.Tokens))
		for i, token := range user.Tokens {
			token.Hash = ""
			out[i] = token
		}
		return out
	}
	return nil
}

// DeleteToken revokes one of the user's tokens.
func (m *Manager) DeleteToken(userID, tokenID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if m.users[i].ID != userID {
			continue
		}
		for j, token := range m.users[i].Tokens {
			if token.ID != tokenID {
				continue
			}
			previous := m.users[i].Tokens
			remaining := make([]Token, 0, len(previous)-1)
			remaining = append(remaining, previous[:j]...)
			remaining = append(remaining, previous[j+1:]...)
			m.users[i].Tokens = remaining
			if err := m.save(); err != nil {
				m.users[i].Tokens = previous
				return err
			}
			return nil
		}
		return errors.New("token not found")
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

func (m *Manager) sessionUserID(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return "", false
	}
	return m.validSession(cookie.Value)
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
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

type requestAccess struct {
	user     User
	scopes   []string
	viaToken bool
	tokenID  string
}

func (m *Manager) accessForToken(raw string) (requestAccess, bool) {
	sum := sha256.Sum256([]byte(raw))
	hash := hex.EncodeToString(sum[:])
	now := time.Now().UTC()
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		for j := range m.users[i].Tokens {
			token := &m.users[i].Tokens[j]
			if subtle.ConstantTimeCompare([]byte(token.Hash), []byte(hash)) != 1 {
				continue
			}
			if token.ExpiresAt != "" {
				expiry, err := time.Parse(time.RFC3339, token.ExpiresAt)
				if err != nil || !expiry.After(now) {
					return requestAccess{}, false
				}
			}
			// Persist last use at most every five minutes to avoid writing the
			// auth store on every API request.
			last, err := time.Parse(time.RFC3339, token.LastUsedAt)
			if token.LastUsedAt == "" || err != nil || now.Sub(last) >= 5*time.Minute {
				token.LastUsedAt = now.Format(time.RFC3339)
				_ = m.save()
			}
			user := m.users[i]
			return requestAccess{
				user:     user,
				scopes:   effectiveScopes(user.Role, token.Scopes),
				viaToken: true,
				tokenID:  token.ID,
			}, true
		}
	}
	return requestAccess{}, false
}

func (m *Manager) requestAccess(r *http.Request) (requestAccess, bool) {
	if !m.Enabled() {
		return requestAccess{
			user:   User{Username: "anonymous", Role: RoleAdmin},
			scopes: roleScopes(RoleAdmin),
		}, true
	}
	if id, ok := m.sessionUserID(r); ok {
		m.mu.Lock()
		user, found := m.userByID(id)
		m.mu.Unlock()
		if found {
			return requestAccess{user: user, scopes: roleScopes(user.Role)}, true
		}
	}
	if raw := bearerToken(r); raw != "" {
		return m.accessForToken(raw)
	}
	return requestAccess{}, false
}

// sessionUser returns the account authenticated by the session cookie only.
// Personal access tokens cannot be used to mint or revoke other tokens.
func (m *Manager) sessionUser(r *http.Request) (User, bool) {
	if !m.Enabled() {
		return User{}, false
	}
	id, ok := m.sessionUserID(r)
	if !ok {
		return User{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.userByID(id)
}

// Role returns the caller's role. When auth is disabled every caller is an
// admin; when it is enabled an unauthenticated caller reports ok=false.
func (m *Manager) Role(r *http.Request) (Role, bool) {
	access, ok := m.requestAccess(r)
	if !ok {
		return "", false
	}
	return access.user.Role, true
}

// Scopes returns the effective scopes granted to this request. Session access
// receives every scope allowed by the account role.
func (m *Manager) Scopes(r *http.Request) ([]string, bool) {
	access, ok := m.requestAccess(r)
	if !ok {
		return nil, false
	}
	return access.scopes, true
}

// CanWrite reports whether the caller may modify data.
func (m *Manager) CanWrite(r *http.Request) bool {
	access, ok := m.requestAccess(r)
	return ok && access.user.Role != RoleReadOnly && hasScope(access.scopes, ScopeWrite)
}

// IsAdmin reports whether the caller may manage accounts and server settings.
func (m *Manager) IsAdmin(r *http.Request) bool {
	access, ok := m.requestAccess(r)
	return ok && access.user.Role == RoleAdmin && hasScope(access.scopes, ScopeAdmin)
}

// Current returns the authenticated account, if any.
func (m *Manager) Current(r *http.Request) (User, bool) {
	access, ok := m.requestAccess(r)
	return access.user, ok
}

// Middleware rejects unauthenticated API requests once auth is enabled.
func (m *Manager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.Enabled() {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := m.requestAccess(r); ok {
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
	r.Post("/setup/password", m.handleSetupPassword)
	r.Post("/login", m.handleLogin)
	r.Post("/logout", m.handleLogout)
	r.Post("/password", m.handleChangePassword)
	r.Get("/tokens", m.handleListTokens)
	r.Post("/tokens", m.handleCreateToken)
	r.Delete("/tokens/{id}", m.handleDeleteToken)

	r.Route("/oidc", func(r chi.Router) {
		r.Get("/config", m.handleOIDCConfig)
		r.Get("/login", m.handleOIDCLogin)
		r.Get("/callback", m.handleOIDCCallback)
		r.Get("/settings", m.handleOIDCSettings)
		r.Put("/settings", m.handleUpdateOIDCSettings)
	})

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
	// Account data is security-sensitive and must never be served from a browser
	// or reverse-proxy cache; otherwise a newly added account can stay invisible.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
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
	passwordEnabled, totpEnabled := m.Methods()
	data := map[string]any{
		"enabled":         m.Enabled(),
		"authenticated":   false,
		"needsSetup":      !m.Enabled(),
		"passwordEnabled": passwordEnabled,
		"totpEnabled":     totpEnabled,
	}
	if cfg := m.OIDC(); cfg != nil && cfg.Enabled {
		label := strings.TrimSpace(cfg.ButtonLabel)
		if label == "" {
			label = "SSO"
		}
		data["oidc"] = map[string]any{"enabled": true, "buttonLabel": label}
	}
	if m.Enabled() {
		if user, ok := m.Current(r); ok {
			data["authenticated"] = true
			data["username"] = user.Username
			data["role"] = user.Role
			data["source"] = userSource(user)
			data["hasPassword"] = user.PasswordHash != ""
			if scopes, ok := m.Scopes(r); ok {
				data["scopes"] = scopes
			}
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

func (m *Manager) handleSetupPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if m.Enabled() {
		fail(w, http.StatusConflict, errors.New("authentication is already configured"))
		return
	}
	user, err := m.SetupWithPassword(req.Username, req.Password)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	setSessionCookie(w, r, m.newSession(user.ID))
	ok(w, map[string]any{"enabled": true, "username": user.Username, "role": user.Role})
}

func (m *Manager) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Code     string `json:"code"`
		Password string `json:"password"`
		Method   string `json:"method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	var user User
	var err error
	if req.Method == "password" || req.Password != "" {
		user, err = m.LoginPassword(req.Username, req.Password)
	} else {
		user, err = m.Login(req.Username, req.Code)
	}
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

func (m *Manager) requireSessionUser(w http.ResponseWriter, r *http.Request) (User, bool) {
	user, ok := m.sessionUser(r)
	if !ok {
		fail(w, http.StatusUnauthorized, errors.New("a browser session is required"))
		return User{}, false
	}
	return user, true
}

func (m *Manager) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	user, authorized := m.requireSessionUser(w, r)
	if !authorized {
		return
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if err := m.ChangePassword(user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		if errors.Is(err, ErrInvalidPassword) {
			fail(w, http.StatusUnauthorized, errors.New("current password is incorrect"))
			return
		}
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"updated": true})
}

func (m *Manager) handleListTokens(w http.ResponseWriter, r *http.Request) {
	user, authorized := m.requireSessionUser(w, r)
	if !authorized {
		return
	}
	ok(w, m.ListTokens(user.ID))
}

func (m *Manager) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	user, authorized := m.requireSessionUser(w, r)
	if !authorized {
		return
	}
	var req struct {
		Name      string   `json:"name"`
		Scopes    []string `json:"scopes"`
		ExpiresAt string   `json:"expiresAt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	raw, token, err := m.CreateToken(user.ID, req.Name, req.Scopes, req.ExpiresAt)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	token.Hash = ""
	ok(w, map[string]any{"token": raw, "info": token})
}

func (m *Manager) handleDeleteToken(w http.ResponseWriter, r *http.Request) {
	user, authorized := m.requireSessionUser(w, r)
	if !authorized {
		return
	}
	if err := m.DeleteToken(user.ID, chi.URLParam(r, "id")); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	ok(w, map[string]any{"deleted": chi.URLParam(r, "id")})
}

func (m *Manager) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	users := m.ListUsers()
	out := make([]map[string]any, 0, len(users))
	for _, user := range users {
		out = append(out, map[string]any{
			"id":          user.ID,
			"username":    user.Username,
			"role":        user.Role,
			"createdAt":   user.CreatedAt,
			"source":      userSource(user),
			"hasPassword": user.PasswordHash != "",
			"hasTOTP":     user.Secret != "",
			"email":       user.Email,
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
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if req.Password != "" {
		user, err := m.CreatePasswordUser(req.Username, req.Role, req.Password)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		ok(w, map[string]any{
			"id":          user.ID,
			"username":    user.Username,
			"role":        user.Role,
			"source":      userSource(user),
			"hasPassword": true,
			"hasTOTP":     false,
		})
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
		Role     *Role  `json:"role"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if req.Role == nil && req.Password == "" {
		fail(w, http.StatusBadRequest, errors.New("no fields to update"))
		return
	}
	id := chi.URLParam(r, "id")
	role := Role("")
	if req.Role != nil {
		if err := m.UpdateUserRole(id, *req.Role); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		role = *req.Role
	}
	if req.Password != "" {
		if err := m.SetUserPassword(id, req.Password); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
	}
	ok(w, map[string]any{"id": id, "role": role})
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
