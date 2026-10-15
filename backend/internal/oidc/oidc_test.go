package oidc

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// signRS256 builds a JWT signed with the given RSA key.
func signRS256(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header := map[string]any{"alg": "RS256", "typ": "JWT", "kid": kid}
	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)
	signingInput := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(claimsJSON)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func jwksFor(key *rsa.PublicKey, kid string) []byte {
	eBytes := big.NewInt(int64(key.E)).Bytes()
	doc := map[string]any{"keys": []map[string]any{{
		"kty": "RSA",
		"kid": kid,
		"use": "sig",
		"alg": "RS256",
		"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(eBytes),
	}}}
	data, _ := json.Marshal(doc)
	return data
}

func newProviderServer(t *testing.T, key *rsa.PrivateKey, kid string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	var server *httptest.Server
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                 server.URL,
			"authorization_endpoint": server.URL + "/authorize",
			"token_endpoint":         server.URL + "/token",
			"jwks_uri":               server.URL + "/jwks",
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(jwksFor(&key.PublicKey, kid))
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestVerifyIDTokenRSA(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	const kid = "test-key"
	server := newProviderServer(t, key, kid)
	provider := New(server.URL)

	claims := map[string]any{
		"iss":                server.URL,
		"aud":                "client-123",
		"sub":                "user-1",
		"preferred_username": "alice",
		"email":              "alice@example.com",
		"nonce":              "nonce-abc",
		"exp":                float64(time.Now().Add(time.Hour).Unix()),
	}
	token := signRS256(t, key, kid, claims)

	got, err := provider.VerifyIDToken(context.Background(), token, "client-123", "nonce-abc")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.String("preferred_username") != "alice" {
		t.Fatalf("unexpected username: %q", got.String("preferred_username"))
	}
}

func TestVerifyIDTokenRejectsBadNonceAndAudience(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	const kid = "k1"
	server := newProviderServer(t, key, kid)
	provider := New(server.URL)

	base := map[string]any{
		"iss":   server.URL,
		"aud":   "client-123",
		"sub":   "user-1",
		"exp":   float64(time.Now().Add(time.Hour).Unix()),
		"nonce": "expected",
	}
	token := signRS256(t, key, kid, base)

	if _, err := provider.VerifyIDToken(context.Background(), token, "client-123", "wrong"); err == nil {
		t.Fatal("expected nonce mismatch")
	}
	if _, err := provider.VerifyIDToken(context.Background(), token, "other-client", "expected"); err == nil {
		t.Fatal("expected audience mismatch")
	}
}

func TestVerifyIDTokenRejectsExpired(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	const kid = "k1"
	server := newProviderServer(t, key, kid)
	provider := New(server.URL)

	token := signRS256(t, key, kid, map[string]any{
		"iss": server.URL,
		"aud": "client-123",
		"sub": "user-1",
		"exp": float64(time.Now().Add(-time.Minute).Unix()),
	})
	if _, err := provider.VerifyIDToken(context.Background(), token, "client-123", ""); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestCodeChallengeS256(t *testing.T) {
	// RFC 7636 Appendix B test vector.
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	want := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if got := CodeChallengeS256(verifier); got != want {
		t.Fatalf("challenge = %q, want %q", got, want)
	}
}
