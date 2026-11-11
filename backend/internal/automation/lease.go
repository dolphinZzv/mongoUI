package automation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Lease elects one automation leader across multiple MongoUI instances. It
// stores a single document in a coordination MongoDB and renews it every tick.
// Without a lease the manager runs in single-instance mode.
type Lease struct {
	client *mongo.Client
	coll   *mongo.Collection
	owner  string
	ttl    time.Duration

	mu     sync.Mutex
	leader bool
	until  time.Time
}

// NewLease connects to the coordination MongoDB. database defaults to
// "mongoui" when empty.
func NewLease(uri, database string) (*Lease, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}
	if database == "" {
		database = "mongoui"
	}
	random := make([]byte, 4)
	_, _ = rand.Read(random)
	host, _ := os.Hostname()
	return &Lease{
		client: client,
		coll:   client.Database(database).Collection("locks"),
		owner:  fmt.Sprintf("%s-%d-%s", host, os.Getpid(), hex.EncodeToString(random)),
		ttl:    45 * time.Second,
	}, nil
}

// Acquire renews or takes the automation lease.
func (l *Lease) Acquire(ctx context.Context) bool {
	return l.AcquireNamed(ctx, "automation")
}

// AcquireNamed renews or takes a named lease. It returns true only for the
// current leader for that name.
func (l *Lease) AcquireNamed(ctx context.Context, name string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	result := l.coll.FindOneAndUpdate(ctx,
		bson.M{
			"_id": name,
			"$or": []bson.M{
				{"expiresAt": bson.M{"$lt": now}},
				{"owner": l.owner},
			},
		},
		bson.M{"$set": bson.M{
			"owner":     l.owner,
			"expiresAt": now.Add(l.ttl),
			"updatedAt": now,
		}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	)
	var document struct {
		Owner string `bson:"owner"`
	}
	if err := result.Decode(&document); err != nil {
		l.leader = false
		return false
	}
	l.leader = document.Owner == l.owner
	if l.leader {
		l.until = now.Add(l.ttl)
	}
	return l.leader
}

// Collection returns a collection in the coordination database.
func (l *Lease) Collection(name string) *mongo.Collection {
	return l.coll.Database().Collection(name)
}

// Close releases the lease when this instance still owns it.
func (l *Lease) Close() {
	if l == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = l.coll.DeleteOne(ctx, bson.M{"_id": "automation", "owner": l.owner})
	_ = l.client.Disconnect(ctx)
}
