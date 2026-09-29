package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// SSHConfig describes an optional SSH jump host (bastion) used to reach the
// MongoDB deployment.
type SSHConfig struct {
	Enabled bool   `json:"enabled"`
	Host    string `json:"host,omitempty"`
	Port    int    `json:"port,omitempty"`
	User    string `json:"user,omitempty"`
	// AuthMethod is "password" or "privateKey"; empty means it is inferred from
	// which credential is present.
	AuthMethod string `json:"authMethod,omitempty"`
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"privateKey,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	// KnownHosts is an optional path to an OpenSSH known_hosts file. When empty
	// the host key is not verified (documented in the UI).
	KnownHosts string `json:"knownHosts,omitempty"`
}

// Connection is a saved MongoDB connection profile.
type Connection struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	URI       string     `json:"uri"`
	Color     string     `json:"color,omitempty"`
	ReadOnly  bool       `json:"readOnly,omitempty"`
	SSH       *SSHConfig `json:"ssh,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// ErrNotFound is returned when a connection does not exist.
var ErrNotFound = errors.New("connection not found")

// Store persists connections to a JSON file.
type Store struct {
	path   string
	cipher *Cipher

	mu    sync.RWMutex
	conns []Connection
}

type storeFile struct {
	Connections []Connection `json:"connections"`
}

// NewStore loads (or creates) the store backed by path, without encryption.
func NewStore(path string) (*Store, error) {
	return NewStoreWithSecret(path, nil)
}

// NewStoreWithSecret loads the store, transparently decrypting sensitive fields
// with cipher (nil disables encryption). Plaintext stores are re-written
// encrypted on first load.
func NewStoreWithSecret(path string, cipher *Cipher) (*Store, error) {
	s := &Store{path: path, cipher: cipher}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.conns = []Connection{}
			return nil
		}
		return err
	}
	var f storeFile
	if len(data) > 0 {
		if err := json.Unmarshal(data, &f); err != nil {
			return err
		}
	}
	if f.Connections == nil {
		f.Connections = []Connection{}
	}

	migrate := false
	if s.cipher != nil {
		for i := range f.Connections {
			if needsEncryption(f.Connections[i]) {
				migrate = true
			}
			dec, err := s.cipher.decryptConnection(f.Connections[i])
			if err != nil {
				return err
			}
			f.Connections[i] = dec
		}
	}
	s.conns = f.Connections
	if migrate {
		return s.persistLocked()
	}
	return nil
}

func (s *Store) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	conns := s.conns
	if s.cipher != nil {
		conns = make([]Connection, len(s.conns))
		for i, c := range s.conns {
			enc, err := s.cipher.encryptConnection(c)
			if err != nil {
				return err
			}
			conns[i] = enc
		}
	}
	data, err := json.MarshalIndent(storeFile{Connections: conns}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns all connections sorted by name.
func (s *Store) List() []Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Connection, len(s.conns))
	copy(out, s.conns)
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out
}

// Get returns a connection by id.
func (s *Store) Get(id string) (Connection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.conns {
		if c.ID == id {
			return c, true
		}
	}
	return Connection{}, false
}

// Add inserts a new connection.
func (s *Store) Add(c Connection) (Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	c.CreatedAt = now
	c.UpdatedAt = now
	s.conns = append(s.conns, c)
	if err := s.persistLocked(); err != nil {
		return Connection{}, err
	}
	return c, nil
}

// Update replaces an existing connection.
func (s *Store) Update(id string, c Connection) (Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.conns {
		if s.conns[i].ID == id {
			c.ID = id
			c.CreatedAt = s.conns[i].CreatedAt
			c.UpdatedAt = time.Now().UTC()
			s.conns[i] = c
			if err := s.persistLocked(); err != nil {
				return Connection{}, err
			}
			return c, nil
		}
	}
	return Connection{}, ErrNotFound
}

// Delete removes a connection.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.conns {
		if s.conns[i].ID == id {
			s.conns = append(s.conns[:i], s.conns[i+1:]...)
			return s.persistLocked()
		}
	}
	return ErrNotFound
}
