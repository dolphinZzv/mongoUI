package mongoclient

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"

	"mongoui/internal/config"
)

// entry is a live MongoDB client plus the SSH tunnel backing it (if any).
type entry struct {
	client *mongo.Client
	tunnel *sshTunnel
}

func (e *entry) close() {
	if e == nil {
		return
	}
	_ = e.client.Disconnect(context.Background())
	if e.tunnel != nil {
		_ = e.tunnel.Close()
	}
}

// Manager keeps track of live MongoDB clients keyed by connection id.
type Manager struct {
	mu      sync.Mutex
	clients map[string]*entry
}

// NewManager creates an empty client manager.
func NewManager() *Manager {
	return &Manager{clients: make(map[string]*entry)}
}

// Connect dials the given URI (optionally through an SSH tunnel) and stores the
// client under id. An existing client for the same id is closed first.
func (m *Manager) Connect(ctx context.Context, id, uri string, sshCfg *config.SSHConfig) error {
	client, tunnel, err := newClient(ctx, uri, sshCfg)
	if err != nil {
		return err
	}

	m.mu.Lock()
	old := m.clients[id]
	m.clients[id] = &entry{client: client, tunnel: tunnel}
	m.mu.Unlock()

	old.close()
	return nil
}

// Test dials the URI without storing the client.
func Test(ctx context.Context, uri string, sshCfg *config.SSHConfig) error {
	client, tunnel, err := newClient(ctx, uri, sshCfg)
	if err != nil {
		return err
	}
	_ = client.Disconnect(context.Background())
	if tunnel != nil {
		_ = tunnel.Close()
	}
	return nil
}

func newClient(ctx context.Context, uri string, sshCfg *config.SSHConfig) (*mongo.Client, *sshTunnel, error) {
	opts := options.Client().ApplyURI(uri)
	opts.SetConnectTimeout(10 * time.Second)
	opts.SetServerSelectionTimeout(10 * time.Second)

	var tunnel *sshTunnel
	if sshCfg != nil && sshCfg.Enabled {
		var err error
		tunnel, err = newSSHTunnel(ctx, *sshCfg)
		if err != nil {
			return nil, nil, err
		}
		opts.SetDialer(tunnel)
	}

	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, nil, fmt.Errorf("ping failed: %w", err)
	}
	return client, tunnel, nil
}

// Get returns the live client for id.
func (m *Manager) Get(id string) (*mongo.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.clients[id]
	if !ok {
		return nil, fmt.Errorf("connection is not active")
	}
	return e.client, nil
}

// IsConnected reports whether id has a live client.
func (m *Manager) IsConnected(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.clients[id]
	return ok
}

// ConnectedIDs returns the ids of all live clients.
func (m *Manager) ConnectedIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.clients))
	for id := range m.clients {
		ids = append(ids, id)
	}
	return ids
}

// Disconnect closes and removes the client for id.
func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	e := m.clients[id]
	delete(m.clients, id)
	m.mu.Unlock()
	e.close()
}

// CloseAll closes every live client.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	clients := m.clients
	m.clients = make(map[string]*entry)
	m.mu.Unlock()

	for _, e := range clients {
		e.close()
	}
}
