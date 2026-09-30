// Package auth adds optional TOTP (RFC 6238) authentication in front of the
// HTTP API. On first run the user must enable it; afterwards a 6-digit code
// issues a signed session cookie. The secret is stored encrypted at rest with
// the same master key as the connection store.
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
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"mongoui/internal/config"
)

const (
	cookieName  = "mongoui_session"
	sessionTTL  = 30 * 24 * time.Hour
	issuerName  = "MongoUI"
	accountName = "admin"
)

// ErrInvalidCode is returned when a submitted TOTP code does not match.
var ErrInvalidCode = errors.New("invalid code")

type storedConfig struct {
	Enabled bool   `json:"enabled"`
	Secret  string `json:"secret"`
}

// Manager holds the TOTP secret and session signing key.
type Manager struct {
	mu         sync.Mutex
	path       string
	cipher     *config.Cipher
	sessionKey []byte
	enabled    bool
	secret     string
	pending    string
}

// New loads (or prepares) the auth state under dataDir. masterKey derives the
// session signing key; cipher encrypts the TOTP secret at rest (both may be nil
// in tests).
func New(dataDir string, cipher *config.Cipher, masterKey []byte) (*Manager, error) {
	m := &Manager{path: filepath.Join(dataDir, "auth.json"), cipher: cipher}
	mac := hmac.New(sha256.New, masterKey)
	mac.Write([]byte("mongoui-session"))
	m.sessionKey = mac.Sum(nil)
	if err := m.load(); err != nil {
		return nil, err
	}
	return m, nil
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
	secret := sc.Secret
	if m.cipher != nil {
		secret, err = m.cipher.Decrypt(secret)
		if err != nil {
			return err
		}
	}
	m.secret = secret
	m.enabled = sc.Enabled && secret != ""
	return nil
}

func (m *Manager) save() error {
	secret := m.secret
	if m.cipher != nil {
		enc, err := m.cipher.Encrypt(secret)
		if err != nil {
			return err
		}
		secret = enc
	}
	data, err := json.MarshalIndent(storedConfig{Enabled: m.enabled, Secret: secret}, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

// Enabled reports whether TOTP has been configured.
func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

// --- TOTP -------------------------------------------------------------------

// BeginSetup generates a fresh secret and returns it with the otpauth URI and a
// QR data URL. It only works while TOTP is not yet enabled.
func (m *Manager) BeginSetup() (secret, uri, qr string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.enabled {
		return "", "", "", errors.New("TOTP is already enabled")
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: issuerName, AccountName: accountName})
	if err != nil {
		return "", "", "", err
	}
	m.pending = key.Secret()
	qr, err = qrDataURL(key)
	if err != nil {
		return "", "", "", err
	}
	return key.Secret(), key.URL(), qr, nil
}

// ConfirmSetup validates the pending secret with a code and enables TOTP.
func (m *Manager) ConfirmSetup(code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.enabled {
		return errors.New("TOTP is already enabled")
	}
	if m.pending == "" {
		return errors.New("setup has not been started")
	}
	if !totp.Validate(strings.TrimSpace(code), m.pending) {
		return ErrInvalidCode
	}
	m.secret = m.pending
	m.pending = ""
	m.enabled = true
	return m.save()
}

// Login validates a code against the configured secret.
func (m *Manager) Login(code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.enabled {
		return nil
	}
	if !totp.Validate(strings.TrimSpace(code), m.secret) {
		return ErrInvalidCode
	}
	return nil
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

func (m *Manager) newSession() string {
	expiry := strconv.FormatInt(time.Now().Add(sessionTTL).Unix(), 10)
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write([]byte(expiry))
	return base64.RawURLEncoding.EncodeToString([]byte(expiry)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (m *Manager) validSession(token string) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return false
	}
	expiry, err := strconv.ParseInt(string(payload), 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < expiry
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

func (m *Manager) authenticated(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	return err == nil && m.validSession(c.Value)
}

// Middleware rejects unauthenticated API requests once TOTP is enabled.
func (m *Manager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.Enabled() || m.authenticated(r) {
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

func (m *Manager) handleStatus(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]any{
		"enabled":       m.Enabled(),
		"authenticated": m.authenticated(r),
		"needsSetup":    !m.Enabled(),
	})
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
	if err := m.ConfirmSetup(req.Code); err != nil {
		if errors.Is(err, ErrInvalidCode) {
			fail(w, http.StatusUnauthorized, err)
			return
		}
		fail(w, http.StatusBadRequest, err)
		return
	}
	setSessionCookie(w, r, m.newSession())
	ok(w, map[string]any{"enabled": true})
}

func (m *Manager) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req codeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if err := m.Login(req.Code); err != nil {
		fail(w, http.StatusUnauthorized, err)
		return
	}
	setSessionCookie(w, r, m.newSession())
	ok(w, map[string]any{"authenticated": true})
}

func (m *Manager) handleLogout(w http.ResponseWriter, _ *http.Request) {
	clearSessionCookie(w)
	ok(w, map[string]any{"authenticated": false})
}
