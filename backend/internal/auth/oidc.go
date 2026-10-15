package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"mongoui/internal/config"
	"mongoui/internal/oidc"
)

const (
	flowCookieName = "mongoui_oidc"
	flowTTL        = 10 * time.Minute
)

// OIDCConfig is the single sign-on configuration. ClientSecret is encrypted at
// rest and never returned to the client.
type OIDCConfig struct {
	Enabled      bool     `json:"enabled"`
	Issuer       string   `json:"issuer"`
	ClientID     string   `json:"clientId"`
	ClientSecret string   `json:"clientSecret,omitempty"`
	RedirectURL  string   `json:"redirectUrl,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
	ButtonLabel  string   `json:"buttonLabel,omitempty"`

	// TokenAuthMethod is "client_secret_basic" (default) or "client_secret_post".
	TokenAuthMethod string `json:"tokenAuthMethod,omitempty"`
	// UsernameClaim overrides the claim used as the account name. When empty,
	// preferred_username / email / upn / sub are tried in order.
	UsernameClaim string `json:"usernameClaim,omitempty"`
	// GroupsClaim is the claim holding group/role memberships (default "groups").
	GroupsClaim string `json:"groupsClaim,omitempty"`

	DefaultRole         Role     `json:"defaultRole"`
	AdminGroups         []string `json:"adminGroups,omitempty"`
	ReadWriteGroups     []string `json:"readWriteGroups,omitempty"`
	ReadOnlyGroups      []string `json:"readOnlyGroups,omitempty"`
	RequireGroupMatch   bool     `json:"requireGroupMatch"`
	AllowedDomains      []string `json:"allowedDomains,omitempty"`
	AllowedEmails       []string `json:"allowedEmails,omitempty"`
	RequireVerifiedMail bool     `json:"requireVerifiedEmail"`
	AutoCreateUsers     bool     `json:"autoCreateUsers"`
	SyncRole            bool     `json:"syncRole"`
}

type oidcSettingsResponse struct {
	*OIDCConfig
	HasClientSecret bool `json:"hasClientSecret"`
}

type oidcFlow struct {
	State       string `json:"state"`
	Nonce       string `json:"nonce"`
	Verifier    string `json:"verifier"`
	RedirectURI string `json:"redirectUri"`
	Issuer      string `json:"issuer"`
}

// --- configuration ----------------------------------------------------------

// oidcToStore returns a copy with the client secret encrypted for persistence.
func oidcToStore(cfg *OIDCConfig, cipher *config.Cipher) (*OIDCConfig, error) {
	if cfg == nil {
		return nil, nil
	}
	out := *cfg
	if cipher != nil && out.ClientSecret != "" {
		enc, err := cipher.Encrypt(out.ClientSecret)
		if err != nil {
			return nil, err
		}
		out.ClientSecret = enc
	}
	return &out, nil
}

func (c OIDCConfig) validate() error {
	if !c.Enabled {
		return nil
	}
	issuer := strings.TrimSpace(c.Issuer)
	if issuer == "" {
		return errors.New("issuer is required")
	}
	parsed, err := url.Parse(issuer)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("issuer must be an http(s) URL")
	}
	if parsed.Scheme == "http" && !isLoopbackHost(parsed.Hostname()) {
		return errors.New("issuer must use https (http is only allowed for localhost)")
	}
	if strings.TrimSpace(c.ClientID) == "" {
		return errors.New("client id is required")
	}
	switch c.TokenAuthMethod {
	case "", "client_secret_basic", "client_secret_post":
	default:
		return errors.New("tokenAuthMethod must be client_secret_basic or client_secret_post")
	}
	if c.DefaultRole != "" && !validRole(c.DefaultRole) {
		return errors.New("invalid default role")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
}

func (c OIDCConfig) usernameClaims() []string {
	if strings.TrimSpace(c.UsernameClaim) != "" {
		return []string{strings.TrimSpace(c.UsernameClaim)}
	}
	return []string{"preferred_username", "email", "upn", "sub"}
}

func (c OIDCConfig) groupsClaimName() string {
	if strings.TrimSpace(c.GroupsClaim) != "" {
		return strings.TrimSpace(c.GroupsClaim)
	}
	return "groups"
}

func (c OIDCConfig) defaultRole() Role {
	if c.DefaultRole == "" {
		return RoleReadOnly
	}
	return c.DefaultRole
}

// resolveRole maps the token's groups to a MongoUI role.
func (c OIDCConfig) resolveRole(claims oidc.Claims) (Role, bool) {
	groups := claims.Strings(c.groupsClaimName())
	if len(groups) == 0 {
		// Some providers put roles in a "roles" claim; fall back to it.
		groups = claims.Strings("roles")
	}
	switch {
	case containsFold(groups, c.AdminGroups):
		return RoleAdmin, true
	case containsFold(groups, c.ReadWriteGroups):
		return RoleReadWrite, true
	case containsFold(groups, c.ReadOnlyGroups):
		return RoleReadOnly, true
	}
	if c.RequireGroupMatch && (len(c.AdminGroups)+len(c.ReadWriteGroups)+len(c.ReadOnlyGroups)) > 0 {
		return "", false
	}
	return c.defaultRole(), true
}

func (c OIDCConfig) emailAllowed(email string) bool {
	if len(c.AllowedEmails) == 0 && len(c.AllowedDomains) == 0 {
		return true
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return false
	}
	for _, allowed := range c.AllowedEmails {
		if strings.EqualFold(strings.TrimSpace(allowed), email) {
			return true
		}
	}
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	domain := email[at+1:]
	for _, allowed := range c.AllowedDomains {
		if strings.EqualFold(strings.TrimPrefix(strings.TrimSpace(allowed), "@"), domain) {
			return true
		}
	}
	return false
}

func (c OIDCConfig) redirectURI(r *http.Request) string {
	if strings.TrimSpace(c.RedirectURL) != "" {
		return strings.TrimSpace(c.RedirectURL)
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := r.Host
	if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
		host = forwarded
	}
	return scheme + "://" + host + "/api/auth/oidc/callback"
}

// OIDC returns a copy of the current configuration, or nil when unset.
func (m *Manager) OIDC() *OIDCConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.oidc == nil {
		return nil
	}
	out := *m.oidc
	return &out
}

// SetOIDC validates and persists the configuration. A blank client secret keeps
// the existing one.
func (m *Manager) SetOIDC(cfg OIDCConfig) error {
	if err := cfg.validate(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.TrimSpace(cfg.ClientSecret) == "" && m.oidc != nil {
		cfg.ClientSecret = m.oidc.ClientSecret
	}
	cfg.Issuer = strings.TrimRight(strings.TrimSpace(cfg.Issuer), "/")
	cfg.ClientID = strings.TrimSpace(cfg.ClientID)
	if cfg.Scopes == nil {
		cfg.Scopes = []string{"openid", "profile", "email"}
	}
	m.oidc = &cfg
	// The provider metadata may have changed; drop the cache.
	m.oidcMu.Lock()
	m.oidcProvider = nil
	m.oidcMu.Unlock()
	return m.save()
}

func (m *Manager) oidcProviderFor(cfg *OIDCConfig) *oidc.Provider {
	m.oidcMu.Lock()
	defer m.oidcMu.Unlock()
	if m.oidcProvider == nil || m.oidcProvider.Issuer() != strings.TrimRight(cfg.Issuer, "/") {
		m.oidcProvider = oidc.New(cfg.Issuer)
	}
	return m.oidcProvider
}

// --- flow cookie ------------------------------------------------------------

func (m *Manager) signFlow(data []byte) string {
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (m *Manager) verifyFlow(token string) ([]byte, bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, false
	}
	data, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	sig, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	if err1 != nil || err2 != nil {
		return nil, false
	}
	mac := hmac.New(sha256.New, m.sessionKey)
	mac.Write(data)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, false
	}
	return data, true
}

func setFlowCookie(w http.ResponseWriter, r *http.Request, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     flowCookieName,
		Value:    value,
		Path:     "/api/auth/oidc",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		MaxAge:   int(flowTTL.Seconds()),
	})
}

func clearFlowCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:   flowCookieName,
		Value:  "",
		Path:   "/api/auth/oidc",
		MaxAge: -1,
	})
}

// --- HTTP handlers ----------------------------------------------------------

func (m *Manager) handleOIDCConfig(w http.ResponseWriter, _ *http.Request) {
	cfg := m.OIDC()
	enabled := cfg != nil && cfg.Enabled
	label := ""
	if enabled {
		label = strings.TrimSpace(cfg.ButtonLabel)
	}
	ok(w, map[string]any{"enabled": enabled, "buttonLabel": label})
}

func (m *Manager) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	cfg := m.OIDC()
	if cfg == nil || !cfg.Enabled {
		redirectOIDCError(w, r, "single sign-on is not enabled")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	provider := m.oidcProviderFor(cfg)
	disc, err := provider.Discovery(ctx)
	if err != nil {
		redirectOIDCError(w, r, err.Error())
		return
	}
	state, err := oidc.RandomToken(24)
	if err != nil {
		redirectOIDCError(w, r, "cannot generate login state")
		return
	}
	nonce, err := oidc.RandomToken(24)
	if err != nil {
		redirectOIDCError(w, r, "cannot generate login nonce")
		return
	}
	verifier, err := oidc.RandomToken(32)
	if err != nil {
		redirectOIDCError(w, r, "cannot generate PKCE verifier")
		return
	}
	redirectURI := cfg.redirectURI(r)
	flow := oidcFlow{State: state, Nonce: nonce, Verifier: verifier, RedirectURI: redirectURI, Issuer: cfg.Issuer}
	data, err := json.Marshal(flow)
	if err != nil {
		redirectOIDCError(w, r, "cannot start login")
		return
	}
	setFlowCookie(w, r, m.signFlow(data))
	http.Redirect(w, r, oidc.AuthCodeURL(disc, cfg.ClientID, redirectURI, cfg.Scopes, state, nonce, oidc.CodeChallengeS256(verifier)), http.StatusFound)
}

func (m *Manager) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	cfg := m.OIDC()
	if cfg == nil || !cfg.Enabled {
		redirectOIDCError(w, r, "single sign-on is not enabled")
		return
	}
	if errText := r.URL.Query().Get("error"); errText != "" {
		message := errText
		if desc := r.URL.Query().Get("error_description"); desc != "" {
			message += ": " + desc
		}
		redirectOIDCError(w, r, message)
		return
	}

	cookie, err := r.Cookie(flowCookieName)
	if err != nil {
		redirectOIDCError(w, r, "login session has expired, please try again")
		return
	}
	clearFlowCookie(w)
	data, ok := m.verifyFlow(cookie.Value)
	if !ok {
		redirectOIDCError(w, r, "invalid login session")
		return
	}
	var flow oidcFlow
	if err := json.Unmarshal(data, &flow); err != nil || flow.Issuer != cfg.Issuer {
		redirectOIDCError(w, r, "invalid login session")
		return
	}
	if r.URL.Query().Get("state") != flow.State {
		redirectOIDCError(w, r, "login state mismatch")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		redirectOIDCError(w, r, "missing authorization code")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	provider := m.oidcProviderFor(cfg)
	disc, err := provider.Discovery(ctx)
	if err != nil {
		redirectOIDCError(w, r, err.Error())
		return
	}
	token, err := provider.Exchange(ctx, disc, cfg.ClientID, cfg.ClientSecret, flow.RedirectURI, code, flow.Verifier, cfg.TokenAuthMethod)
	if err != nil {
		redirectOIDCError(w, r, err.Error())
		return
	}
	claims, err := provider.VerifyIDToken(ctx, token.IDToken, cfg.ClientID, flow.Nonce)
	if err != nil {
		redirectOIDCError(w, r, err.Error())
		return
	}
	if cfg.RequireVerifiedMail {
		verified, _ := claims["email_verified"].(bool)
		if !verified {
			redirectOIDCError(w, r, "email address is not verified")
			return
		}
	}
	email := claims.String("email")
	if !cfg.emailAllowed(email) {
		redirectOIDCError(w, r, "this account is not allowed to sign in")
		return
	}
	role, ok := cfg.resolveRole(claims)
	if !ok {
		redirectOIDCError(w, r, "your groups do not grant access")
		return
	}
	username := claims.String(cfg.usernameClaims()...)
	user, err := m.provisionOIDCUser(username, email, role, cfg)
	if err != nil {
		redirectOIDCError(w, r, err.Error())
		return
	}
	setSessionCookie(w, r, m.newSession(user.ID))
	http.Redirect(w, r, "/", http.StatusFound)
}

func (m *Manager) handleOIDCSettings(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	cfg := m.OIDC()
	if cfg == nil {
		cfg = &OIDCConfig{DefaultRole: RoleReadOnly, Scopes: []string{"openid", "profile", "email"}}
	}
	hasSecret := strings.TrimSpace(cfg.ClientSecret) != ""
	safe := *cfg
	safe.ClientSecret = ""
	ok(w, oidcSettingsResponse{OIDCConfig: &safe, HasClientSecret: hasSecret})
}

func (m *Manager) handleUpdateOIDCSettings(w http.ResponseWriter, r *http.Request) {
	if !m.requireAdmin(w, r) {
		return
	}
	var cfg OIDCConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		fail(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	if err := m.SetOIDC(cfg); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	updated := m.OIDC()
	safe := *updated
	safe.ClientSecret = ""
	ok(w, oidcSettingsResponse{OIDCConfig: &safe, HasClientSecret: strings.TrimSpace(updated.ClientSecret) != ""})
}

// provisionOIDCUser finds or creates the account for an SSO identity.
func (m *Manager) provisionOIDCUser(username, email string, role Role, cfg *OIDCConfig) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return User{}, errors.New("the identity provider did not return a username")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.users {
		if !strings.EqualFold(m.users[i].Username, username) {
			continue
		}
		if m.users[i].Source != "oidc" {
			return User{}, errors.New("this username belongs to a local account")
		}
		if cfg.SyncRole {
			m.users[i].Role = role
		}
		if email != "" {
			m.users[i].Email = email
		}
		if err := m.save(); err != nil {
			return User{}, err
		}
		return m.users[i], nil
	}
	for _, pending := range m.pending {
		if strings.EqualFold(pending.username, username) {
			return User{}, errors.New("this username is pending local setup")
		}
	}
	if !cfg.AutoCreateUsers {
		return User{}, errors.New("no account exists for this user; ask an admin to create one")
	}
	user := User{
		ID:        uuid.NewString(),
		Username:  username,
		Role:      role,
		Source:    "oidc",
		Email:     email,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	m.users = append(m.users, user)
	if err := m.save(); err != nil {
		return User{}, err
	}
	return user, nil
}

func redirectOIDCError(w http.ResponseWriter, r *http.Request, message string) {
	target := "/?oidc_error=" + url.QueryEscape(message)
	http.Redirect(w, r, target, http.StatusFound)
}

func containsFold(haystack, needles []string) bool {
	for _, needle := range needles {
		needle = strings.TrimSpace(needle)
		if needle == "" {
			continue
		}
		for _, item := range haystack {
			if strings.EqualFold(strings.TrimSpace(item), needle) {
				return true
			}
		}
	}
	return false
}
