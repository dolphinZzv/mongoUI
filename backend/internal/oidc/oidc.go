// Package oidc implements the OpenID Connect authorization-code flow with
// PKCE, discovery and ID-token verification, using only the standard library.
//
// It intentionally has no MongoUI dependencies so it can be tested in
// isolation. Secrets and user provisioning live in internal/auth.
package oidc

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Discovery is the subset of the OpenID provider metadata we use.
type Discovery struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

// TokenResponse is the token endpoint response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// Claims is the decoded ID-token payload.
type Claims map[string]any

// String returns the first non-empty string claim among keys.
func (c Claims) String(keys ...string) string {
	for _, key := range keys {
		if v, ok := c[key]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
	}
	return ""
}

// Strings returns a claim as a list of strings, accepting a bare string too.
func (c Claims) Strings(key string) []string {
	v, ok := c[key]
	if !ok {
		return nil
	}
	switch value := v.(type) {
	case string:
		if value == "" {
			return nil
		}
		return []string{value}
	case []any:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// Provider discovers and caches the provider metadata and signing keys.
type Provider struct {
	issuer     string
	httpClient *http.Client

	mu          sync.Mutex
	discovery   *Discovery
	jwks        map[string]crypto.PublicKey
	jwksFetched time.Time
}

// New creates a provider for the given issuer.
func New(issuer string) *Provider {
	return &Provider{
		issuer:     strings.TrimRight(strings.TrimSpace(issuer), "/"),
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Issuer returns the configured issuer.
func (p *Provider) Issuer() string { return p.issuer }

// Discovery fetches (and caches) the provider metadata.
func (p *Provider) Discovery(ctx context.Context) (*Discovery, error) {
	p.mu.Lock()
	cached := p.discovery
	p.mu.Unlock()
	if cached != nil {
		return cached, nil
	}
	endpoint := p.issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc discovery failed: %s", res.Status)
	}
	var disc Discovery
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&disc); err != nil {
		return nil, fmt.Errorf("oidc discovery decode: %w", err)
	}
	if disc.AuthorizationEndpoint == "" || disc.TokenEndpoint == "" || disc.JWKSURI == "" {
		return nil, errors.New("oidc discovery is missing required endpoints")
	}
	p.mu.Lock()
	p.discovery = &disc
	p.mu.Unlock()
	return &disc, nil
}

// AuthCodeURL builds the authorization redirect for the code flow with PKCE.
func AuthCodeURL(disc *Discovery, clientID, redirectURI string, scopes []string, state, nonce, codeChallenge string) string {
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", strings.Join(scopes, " "))
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", "S256")
	return disc.AuthorizationEndpoint + "?" + q.Encode()
}

// Exchange trades an authorization code for tokens. authMethod is either
// "client_secret_basic" (default) or "client_secret_post".
func (p *Provider) Exchange(ctx context.Context, disc *Discovery, clientID, clientSecret, redirectURI, code, codeVerifier, authMethod string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", codeVerifier)
	form.Set("client_id", clientID)
	if authMethod == "client_secret_post" && clientSecret != "" {
		form.Set("client_secret", clientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, disc.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if authMethod != "client_secret_post" && clientSecret != "" {
		req.SetBasicAuth(url.QueryEscape(clientID), url.QueryEscape(clientSecret))
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc token exchange failed: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc token exchange failed: %s: %s", res.Status, strings.TrimSpace(string(body)))
	}
	var token TokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("oidc token decode: %w", err)
	}
	if token.IDToken == "" {
		return nil, errors.New("oidc provider did not return an id_token")
	}
	return &token, nil
}

// VerifyIDToken validates the ID token's signature and standard claims and
// returns its payload. When nonce is non-empty it must match.
func (p *Provider) VerifyIDToken(ctx context.Context, rawToken, audience, nonce string) (Claims, error) {
	disc, err := p.Discovery(ctx)
	if err != nil {
		return nil, err
	}
	header, payload, signingInput, signature, err := splitJWT(rawToken)
	if err != nil {
		return nil, err
	}
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(header, &hdr); err != nil {
		return nil, errors.New("oidc id_token has an invalid header")
	}
	if hdr.Alg == "" || hdr.Alg == "none" {
		return nil, errors.New("oidc id_token uses an unsupported algorithm")
	}

	key, err := p.signingKey(ctx, disc.JWKSURI, hdr.Kid)
	if err != nil {
		return nil, err
	}
	if err := verifySignature(hdr.Alg, key, signingInput, signature); err != nil {
		return nil, err
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, errors.New("oidc id_token has an invalid payload")
	}
	if iss := claims.String("iss"); iss == "" || strings.TrimRight(iss, "/") != p.issuer {
		return nil, errors.New("oidc id_token issuer mismatch")
	}
	if !audienceMatches(claims["aud"], audience) {
		return nil, errors.New("oidc id_token audience mismatch")
	}
	now := time.Now()
	if exp, ok := numericClaim(claims["exp"]); ok && now.After(time.Unix(int64(exp), 0)) {
		return nil, errors.New("oidc id_token has expired")
	}
	if nbf, ok := numericClaim(claims["nbf"]); ok && now.Add(time.Minute).Before(time.Unix(int64(nbf), 0)) {
		return nil, errors.New("oidc id_token is not yet valid")
	}
	if nonce != "" {
		if claims.String("nonce") != nonce {
			return nil, errors.New("oidc id_token nonce mismatch")
		}
	}
	return claims, nil
}

// signingKey fetches the JWKS (with a short cache) and returns the key matching
// kid. A missing kid forces a refresh so key rotation is picked up.
func (p *Provider) signingKey(ctx context.Context, jwksURI, kid string) (crypto.PublicKey, error) {
	p.mu.Lock()
	keys := p.jwks
	fresh := time.Since(p.jwksFetched) < time.Hour
	p.mu.Unlock()

	if keys != nil && fresh {
		if key, ok := keys[kid]; ok {
			return key, nil
		}
	}
	fetched, err := p.fetchJWKS(ctx, jwksURI)
	if err != nil {
		if keys != nil {
			if key, ok := keys[kid]; ok {
				return key, nil
			}
		}
		return nil, err
	}
	p.mu.Lock()
	p.jwks = fetched
	p.jwksFetched = time.Now()
	p.mu.Unlock()
	key, ok := fetched[kid]
	if !ok {
		return nil, fmt.Errorf("oidc signing key %q not found", kid)
	}
	return key, nil
}

func (p *Provider) fetchJWKS(ctx context.Context, jwksURI string) (map[string]crypto.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc jwks fetch failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc jwks fetch failed: %s", res.Status)
	}
	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Crv string `json:"crv"`
			N   string `json:"n"`
			E   string `json:"e"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&doc); err != nil {
		return nil, fmt.Errorf("oidc jwks decode: %w", err)
	}
	keys := make(map[string]crypto.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		key, err := parseJWK(k.Kty, k.Crv, k.N, k.E, k.X, k.Y)
		if err != nil {
			continue
		}
		keys[k.Kid] = key
	}
	if len(keys) == 0 {
		return nil, errors.New("oidc jwks contained no usable keys")
	}
	return keys, nil
}

// --- helpers ----------------------------------------------------------------

// NewState returns a random URL-safe token for state/nonce/PKCE verifier.
func RandomToken(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// CodeChallengeS256 derives the PKCE S256 challenge for a verifier.
func CodeChallengeS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func splitJWT(token string) (header, payload, signingInput, signature []byte, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, nil, nil, errors.New("oidc id_token is not a JWT")
	}
	header, err = base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, nil, nil, errors.New("oidc id_token header is not base64url")
	}
	payload, err = base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, nil, nil, errors.New("oidc id_token payload is not base64url")
	}
	signature, err = base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, nil, nil, nil, errors.New("oidc id_token signature is not base64url")
	}
	return header, payload, []byte(parts[0] + "." + parts[1]), signature, nil
}

func parseJWK(kty, crv, n, e, x, y string) (crypto.PublicKey, error) {
	switch kty {
	case "RSA":
		nBytes, err := base64.RawURLEncoding.DecodeString(n)
		if err != nil {
			return nil, err
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(e)
		if err != nil {
			return nil, err
		}
		exp := 0
		for _, b := range eBytes {
			exp = exp<<8 | int(b)
		}
		if exp == 0 {
			return nil, errors.New("invalid RSA exponent")
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: exp}, nil
	case "EC":
		curve, err := curveByName(crv)
		if err != nil {
			return nil, err
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(x)
		if err != nil {
			return nil, err
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(y)
		if err != nil {
			return nil, err
		}
		return &ecdsa.PublicKey{Curve: curve, X: new(big.Int).SetBytes(xBytes), Y: new(big.Int).SetBytes(yBytes)}, nil
	case "OKP":
		if crv != "Ed25519" {
			return nil, errors.New("unsupported OKP curve")
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(x)
		if err != nil {
			return nil, err
		}
		if len(xBytes) != ed25519.PublicKeySize {
			return nil, errors.New("invalid Ed25519 key size")
		}
		return ed25519.PublicKey(xBytes), nil
	default:
		return nil, fmt.Errorf("unsupported JWK key type %q", kty)
	}
}

func curveByName(crv string) (elliptic.Curve, error) {
	switch crv {
	case "P-256":
		return elliptic.P256(), nil
	case "P-384":
		return elliptic.P384(), nil
	case "P-521":
		return elliptic.P521(), nil
	default:
		return nil, fmt.Errorf("unsupported EC curve %q", crv)
	}
}

func verifySignature(alg string, key crypto.PublicKey, signingInput, signature []byte) error {
	if alg == "EdDSA" {
		pub, ok := key.(ed25519.PublicKey)
		if !ok {
			return errors.New("oidc signing key type mismatch")
		}
		if !ed25519.Verify(pub, signingInput, signature) {
			return errors.New("oidc id_token signature is invalid")
		}
		return nil
	}

	var hash crypto.Hash
	switch alg {
	case "RS256", "PS256", "ES256":
		hash = crypto.SHA256
	case "RS384", "PS384", "ES384":
		hash = crypto.SHA384
	case "RS512", "PS512", "ES512":
		hash = crypto.SHA512
	default:
		return fmt.Errorf("unsupported id_token algorithm %q", alg)
	}
	h := hash.New()
	h.Write(signingInput)
	digest := h.Sum(nil)

	switch {
	case strings.HasPrefix(alg, "RS"):
		pub, ok := key.(*rsa.PublicKey)
		if !ok {
			return errors.New("oidc signing key type mismatch")
		}
		if err := rsa.VerifyPKCS1v15(pub, hash, digest, signature); err != nil {
			return errors.New("oidc id_token signature is invalid")
		}
		return nil
	case strings.HasPrefix(alg, "PS"):
		pub, ok := key.(*rsa.PublicKey)
		if !ok {
			return errors.New("oidc signing key type mismatch")
		}
		if err := rsa.VerifyPSS(pub, hash, digest, signature, &rsa.PSSOptions{SaltLength: rsa.PSSSaltLengthAuto, Hash: hash}); err != nil {
			return errors.New("oidc id_token signature is invalid")
		}
		return nil
	case strings.HasPrefix(alg, "ES"):
		pub, ok := key.(*ecdsa.PublicKey)
		if !ok {
			return errors.New("oidc signing key type mismatch")
		}
		keySize := (pub.Curve.Params().BitSize + 7) / 8
		if len(signature) != 2*keySize {
			return errors.New("oidc id_token signature has the wrong length")
		}
		r := new(big.Int).SetBytes(signature[:keySize])
		s := new(big.Int).SetBytes(signature[keySize:])
		if !ecdsa.Verify(pub, digest, r, s) {
			return errors.New("oidc id_token signature is invalid")
		}
		return nil
	}
	return fmt.Errorf("unsupported id_token algorithm %q", alg)
}

func audienceMatches(aud any, expected string) bool {
	switch value := aud.(type) {
	case string:
		return value == expected
	case []any:
		for _, item := range value {
			if s, ok := item.(string); ok && s == expected {
				return true
			}
		}
	}
	return false
}

func numericClaim(v any) (float64, bool) {
	switch value := v.(type) {
	case float64:
		return value, true
	case json.Number:
		f, err := value.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}
