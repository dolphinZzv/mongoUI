package mongoclient

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

// Manager keeps track of live MongoDB clients keyed by connection id.
type Manager struct {
	mu      sync.Mutex
	clients map[string]*mongo.Client
}

// NewManager creates an empty client manager.
func NewManager() *Manager {
	return &Manager{clients: make(map[string]*mongo.Client)}
}

// Connect dials the given URI and stores the client under id.
// An existing client for the same id is closed first.
func (m *Manager) Connect(ctx context.Context, id, uri string) error {
	client, err := newClient(ctx, uri)
	if err != nil {
		return err
	}

	m.mu.Lock()
	old := m.clients[id]
	m.clients[id] = client
	m.mu.Unlock()

	if old != nil {
		_ = old.Disconnect(context.Background())
	}
	return nil
}

// Test dials the URI without storing the client.
func Test(ctx context.Context, uri string) error {
	client, err := newClient(ctx, uri)
	if err != nil {
		return err
	}
	_ = client.Disconnect(context.Background())
	return nil
}

func newClient(ctx context.Context, uri string) (*mongo.Client, error) {
	opts := options.Client().ApplyURI(uri)
	opts.SetConnectTimeout(10 * time.Second)
	opts.SetServerSelectionTimeout(10 * time.Second)

	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		return nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("ping failed: %w", err)
	}
	return client, nil
}

// Get returns the live client for id.
func (m *Manager) Get(id string) (*mongo.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.clients[id]
	if !ok {
		return nil, fmt.Errorf("connection is not active")
	}
	return c, nil
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
	client := m.clients[id]
	delete(m.clients, id)
	m.mu.Unlock()
	if client != nil {
		_ = client.Disconnect(context.Background())
	}
}

// CloseAll closes every live client.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	clients := m.clients
	m.clients = make(map[string]*mongo.Client)
	m.mu.Unlock()

	for _, c := range clients {
		_ = c.Disconnect(context.Background())
	}
}
