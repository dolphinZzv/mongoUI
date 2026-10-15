package auth

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/oidc"
)

func TestResolveRole(t *testing.T) {
	cfg := OIDCConfig{
		AdminGroups:     []string{"admins"},
		ReadWriteGroups: []string{"developers"},
		ReadOnlyGroups:  []string{"viewers"},
		DefaultRole:     RoleReadOnly,
	}
	cases := []struct {
		groups []any
		want   Role
	}{
		{[]any{"admins"}, RoleAdmin},
		{[]any{"developers"}, RoleReadWrite},
		{[]any{"viewers"}, RoleReadOnly},
		{[]any{"something-else"}, RoleReadOnly},
		{[]any{"developers", "admins"}, RoleAdmin},
	}
	for _, tc := range cases {
		role, ok := cfg.resolveRole(oidc.Claims{"groups": tc.groups})
		if !ok || role != tc.want {
			t.Fatalf("groups %v => (%q, %v), want %q", tc.groups, role, ok, tc.want)
		}
	}

	strict := cfg
	strict.RequireGroupMatch = true
	if _, ok := strict.resolveRole(oidc.Claims{"groups": []any{"nobody"}}); ok {
		t.Fatal("expected group match to be required")
	}
}

func TestEmailAllowed(t *testing.T) {
	cfg := OIDCConfig{AllowedDomains: []string{"example.com"}, AllowedEmails: []string{"boss@other.io"}}
	if !cfg.emailAllowed("alice@example.com") {
		t.Fatal("expected example.com to be allowed")
	}
	if !cfg.emailAllowed("boss@other.io") {
		t.Fatal("expected explicit email to be allowed")
	}
	if cfg.emailAllowed("eve@evil.com") {
		t.Fatal("expected evil.com to be rejected")
	}

	open := OIDCConfig{}
	if !open.emailAllowed("anyone@anywhere.test") {
		t.Fatal("empty allow-list should permit anyone")
	}
}

func TestSetOIDCPersistsEncryptedSecret(t *testing.T) {
	dir := t.TempDir()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	cipher, err := config.NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	m, err := New(dir, cipher, key)
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	if err := m.SetOIDC(OIDCConfig{
		Enabled:      true,
		Issuer:       "https://issuer.example.com",
		ClientID:     "client",
		ClientSecret: "top-secret-value",
		DefaultRole:  RoleAdmin,
	}); err != nil {
		t.Fatalf("set oidc: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatalf("read auth.json: %v", err)
	}
	if strings.Contains(string(raw), "top-secret-value") {
		t.Fatal("client secret must be encrypted at rest")
	}

	reloaded, err := New(dir, cipher, key)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := reloaded.OIDC(); got == nil || got.ClientSecret != "top-secret-value" {
		t.Fatalf("secret did not survive reload: %#v", got)
	}

	// A blank secret on update must keep the stored one.
	if err := reloaded.SetOIDC(OIDCConfig{
		Enabled:  true,
		Issuer:   "https://issuer.example.com",
		ClientID: "client",
	}); err != nil {
		t.Fatalf("update oidc: %v", err)
	}
	if reloaded.OIDC().ClientSecret != "top-secret-value" {
		t.Fatal("blank secret should preserve the existing one")
	}
}

func TestProvisionOIDCUser(t *testing.T) {
	key := make([]byte, 32)
	m, err := New(t.TempDir(), nil, key)
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	cfg := &OIDCConfig{AutoCreateUsers: true, SyncRole: true, DefaultRole: RoleReadOnly}

	user, err := m.provisionOIDCUser("alice", "alice@example.com", RoleReadWrite, cfg)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if user.Source != "oidc" || user.Role != RoleReadWrite {
		t.Fatalf("unexpected user: %#v", user)
	}

	// A second login syncs the role.
	updated, err := m.provisionOIDCUser("alice", "alice@example.com", RoleAdmin, cfg)
	if err != nil {
		t.Fatalf("re-provision: %v", err)
	}
	if updated.ID != user.ID || updated.Role != RoleAdmin {
		t.Fatalf("expected the same user with an updated role, got %#v", updated)
	}

	// A local account with the same name must not be taken over.
	if _, _, _, _, err := m.BeginUserSetup("bob", RoleReadOnly); err != nil {
		t.Fatalf("begin setup: %v", err)
	}
	if _, err := m.provisionOIDCUser("bob", "bob@example.com", RoleAdmin, cfg); err == nil {
		t.Fatal("expected a local username to be rejected")
	}

	cfgNoCreate := &OIDCConfig{AutoCreateUsers: false}
	if _, err := m.provisionOIDCUser("carol", "carol@example.com", RoleReadOnly, cfgNoCreate); err == nil {
		t.Fatal("expected provisioning to be rejected when auto-create is off")
	}
}
