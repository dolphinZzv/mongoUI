package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/config"
)

const (
	proposalTTL          = 30 * time.Minute
	proposalApplyTimeout = 10 * time.Minute
	proposalMax          = 100
	proposalSnapshotMax  = 100
	proposalPreviewMax   = 5
	proposalMaxDocBytes  = 15 << 20
)

const (
	ProposalPending    = "pending"
	ProposalApproved   = "approved"
	ProposalApplying   = "applying"
	ProposalApplied    = "applied"
	ProposalFailed     = "failed"
	ProposalRejected   = "rejected"
	ProposalRolledBack = "rolled_back"
)

// Proposal is a write operation preview awaiting explicit human approval.
// Args and Snapshot stay in memory only; API/MCP responses expose Preview.
type Proposal struct {
	ID           string          `json:"id"`
	Tool         string          `json:"tool"`
	Operation    string          `json:"operation"`
	ConnectionID string          `json:"connectionId"`
	Database     string          `json:"database"`
	Collection   string          `json:"collection"`
	Summary      string          `json:"summary"`
	Count        int64           `json:"count"`
	Matches      int64           `json:"-"`
	Rollbackable bool            `json:"rollbackable"`
	Preview      json.RawMessage `json:"preview"`
	Status       string          `json:"status"`
	CreatedBy    string          `json:"createdBy,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
	ApprovedBy   string          `json:"approvedBy,omitempty"`
	ApprovedAt   string          `json:"approvedAt,omitempty"`
	RejectedBy   string          `json:"rejectedBy,omitempty"`
	AppliedAt    string          `json:"appliedAt,omitempty"`
	RolledBackAt string          `json:"rolledBackAt,omitempty"`
	Error        string          `json:"error,omitempty"`
	Result       string          `json:"result,omitempty"`

	Args     map[string]any `json:"-"`
	Snapshot []bson.D       `json:"-"`
	// TargetID pins a single-document update/delete to the document shown in
	// the preview, instead of letting MongoDB pick an arbitrary match later.
	TargetID any `json:"-"`
	// SampleHash detects content changes that keep the match count unchanged.
	SampleHash string `json:"-"`
	// Drop-collection rollback metadata.
	CollectionOptions bson.M   `json:"-"`
	Indexes           []bson.D `json:"-"`
}

type proposalStore struct {
	mu     sync.Mutex
	items  map[string]*Proposal
	order  []string
	path   string
	cipher *config.Cipher
	coll   *mongo.Collection
}

func newProposalStore() *proposalStore {
	return &proposalStore{items: map[string]*Proposal{}}
}

// configureLocal persists proposals in a BSON file, encrypted with the same
// master key as the rest of the server state when available.
func (s *proposalStore) configureLocal(path string, cipher *config.Cipher) {
	s.mu.Lock()
	s.path = path
	s.cipher = cipher
	s.mu.Unlock()
	s.loadLocal()
}

func (s *proposalStore) setCollection(coll *mongo.Collection) {
	s.mu.Lock()
	s.coll = coll
	s.mu.Unlock()
	s.refresh()
}

type proposalDoc struct {
	ID                string   `bson:"_id"`
	Tool              string   `bson:"tool"`
	Operation         string   `bson:"operation"`
	ConnectionID      string   `bson:"connectionId"`
	Database          string   `bson:"database"`
	Collection        string   `bson:"collection"`
	Summary           string   `bson:"summary"`
	Count             int64    `bson:"count"`
	Matches           int64    `bson:"matches"`
	Rollbackable      bool     `bson:"rollbackable"`
	Preview           string   `bson:"preview"`
	Status            string   `bson:"status"`
	CreatedBy         string   `bson:"createdBy,omitempty"`
	CreatedAt         string   `bson:"createdAt"`
	UpdatedAt         string   `bson:"updatedAt"`
	ApprovedBy        string   `bson:"approvedBy,omitempty"`
	ApprovedAt        string   `bson:"approvedAt,omitempty"`
	RejectedBy        string   `bson:"rejectedBy,omitempty"`
	AppliedAt         string   `bson:"appliedAt,omitempty"`
	RolledBackAt      string   `bson:"rolledBackAt,omitempty"`
	Error             string   `bson:"error,omitempty"`
	Result            string   `bson:"result,omitempty"`
	Args              bson.M   `bson:"args"`
	Snapshot          []bson.D `bson:"snapshot,omitempty"`
	TargetID          any      `bson:"targetId,omitempty"`
	SampleHash        string   `bson:"sampleHash,omitempty"`
	CollectionOptions bson.M   `bson:"collectionOptions,omitempty"`
	Indexes           []bson.D `bson:"indexes,omitempty"`
}

type proposalFile struct {
	Items []proposalDoc `bson:"items"`
}

func proposalToDoc(p *Proposal) proposalDoc {
	return proposalDoc{
		ID: p.ID, Tool: p.Tool, Operation: p.Operation, ConnectionID: p.ConnectionID,
		Database: p.Database, Collection: p.Collection, Summary: p.Summary,
		Count: p.Count, Matches: p.Matches, Rollbackable: p.Rollbackable,
		Preview: string(p.Preview), Status: p.Status, CreatedBy: p.CreatedBy,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, ApprovedBy: p.ApprovedBy,
		ApprovedAt: p.ApprovedAt, RejectedBy: p.RejectedBy, AppliedAt: p.AppliedAt,
		RolledBackAt: p.RolledBackAt, Error: p.Error, Result: p.Result,
		Args: bson.M(p.Args), Snapshot: p.Snapshot, TargetID: p.TargetID,
		SampleHash: p.SampleHash, CollectionOptions: p.CollectionOptions, Indexes: p.Indexes,
	}
}

func proposalFromDoc(d proposalDoc) *Proposal {
	return &Proposal{
		ID: d.ID, Tool: d.Tool, Operation: d.Operation, ConnectionID: d.ConnectionID,
		Database: d.Database, Collection: d.Collection, Summary: d.Summary,
		Count: d.Count, Matches: d.Matches, Rollbackable: d.Rollbackable,
		Preview: json.RawMessage(d.Preview), Status: d.Status, CreatedBy: d.CreatedBy,
		CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt, ApprovedBy: d.ApprovedBy,
		ApprovedAt: d.ApprovedAt, RejectedBy: d.RejectedBy, AppliedAt: d.AppliedAt,
		RolledBackAt: d.RolledBackAt, Error: d.Error, Result: d.Result,
		Args: map[string]any(d.Args), Snapshot: d.Snapshot, TargetID: d.TargetID,
		SampleHash: d.SampleHash, CollectionOptions: d.CollectionOptions, Indexes: d.Indexes,
	}
}

func (s *proposalStore) loadLocal() {
	s.mu.Lock()
	path, cipher := s.path, s.cipher
	s.mu.Unlock()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("proposal store: %v", err)
		}
		return
	}
	if len(raw) == 0 {
		return
	}
	data := raw
	if strings.HasPrefix(string(raw), "enc:v1:") {
		if cipher == nil {
			log.Printf("proposal store: encrypted file requires the master key")
			return
		}
		encoded, err := cipher.Decrypt(string(raw))
		if err != nil {
			log.Printf("proposal store: decrypt: %v", err)
			return
		}
		data, err = base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			log.Printf("proposal store: decode: %v", err)
			return
		}
	}
	var file proposalFile
	if err := bson.Unmarshal(data, &file); err != nil {
		log.Printf("proposal store: decode bson: %v", err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = map[string]*Proposal{}
	s.order = nil
	for _, doc := range file.Items {
		p := proposalFromDoc(doc)
		s.items[p.ID] = p
		s.order = append(s.order, p.ID)
	}
}

func (s *proposalStore) saveLocalLocked() {
	if s.path == "" || s.coll != nil {
		return
	}
	file := proposalFile{Items: make([]proposalDoc, 0, len(s.order))}
	for _, id := range s.order {
		if p := s.items[id]; p != nil {
			file.Items = append(file.Items, proposalToDoc(p))
		}
	}
	raw, err := bson.Marshal(file)
	if err != nil {
		log.Printf("proposal store: encode: %v", err)
		return
	}
	data := raw
	if s.cipher != nil {
		encoded := base64.StdEncoding.EncodeToString(raw)
		encrypted, err := s.cipher.Encrypt(encoded)
		if err != nil {
			log.Printf("proposal store: encrypt: %v", err)
			return
		}
		data = []byte(encrypted)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		log.Printf("proposal store: write: %v", err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		log.Printf("proposal store: rename: %v", err)
	}
}

func (s *proposalStore) refresh() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
}

func (s *proposalStore) refreshLocked() {
	if s.coll == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cursor, err := s.coll.Find(ctx, bson.M{})
	if err != nil {
		log.Printf("proposal store: refresh: %v", err)
		return
	}
	defer cursor.Close(ctx)
	var docs []proposalDoc
	if err := cursor.All(ctx, &docs); err != nil {
		log.Printf("proposal store: refresh decode: %v", err)
		return
	}
	s.items = map[string]*Proposal{}
	s.order = nil
	for _, doc := range docs {
		p := proposalFromDoc(doc)
		s.items[p.ID] = p
		s.order = append(s.order, p.ID)
	}
}

func (s *proposalStore) persistLocked(p *Proposal) {
	if s.coll != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := s.coll.ReplaceOne(ctx, bson.M{"_id": p.ID}, proposalToDoc(p), options.Replace().SetUpsert(true))
		if err != nil {
			log.Printf("proposal store: persist: %v", err)
		}
		return
	}
	s.saveLocalLocked()
}

func nowText() string { return time.Now().UTC().Format(time.RFC3339) }

// jsonStd is used for proposal payloads: they contain json.RawMessage previews
// and must not be BSON-encoded like database documents.
func jsonStd(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return string(raw), nil
	}
	return buf.String(), nil
}

func (s *proposalStore) cleanupLocked(now time.Time) {
	cutoff := now.Add(-proposalTTL)
	kept := s.order[:0]
	for _, id := range s.order {
		p := s.items[id]
		if p == nil {
			continue
		}
		updated, err := time.Parse(time.RFC3339, p.UpdatedAt)
		if err == nil && updated.Before(cutoff) && p.Status != ProposalApplying {
			delete(s.items, id)
			if s.coll != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_, _ = s.coll.DeleteOne(ctx, bson.M{"_id": id})
				cancel()
			}
			continue
		}
		kept = append(kept, id)
	}
	s.order = kept
}

func (s *proposalStore) create(p *Proposal) *Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.cleanupLocked(now)
	for len(s.order) >= proposalMax {
		oldest := s.order[0]
		s.order = s.order[1:]
		delete(s.items, oldest)
		if s.coll != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, _ = s.coll.DeleteOne(ctx, bson.M{"_id": oldest})
			cancel()
		}
	}
	p.ID = "prop_" + randomToken()
	p.Status = ProposalPending
	p.CreatedAt = now.UTC().Format(time.RFC3339)
	p.UpdatedAt = p.CreatedAt
	s.items[p.ID] = p
	s.order = append(s.order, p.ID)
	s.persistLocked(p)
	copy := *p
	return &copy
}

func cloneProposal(p *Proposal) Proposal {
	if p == nil {
		return Proposal{}
	}
	out := *p
	out.Args = cloneMap(p.Args)
	out.Snapshot = append([]bson.D(nil), p.Snapshot...)
	out.Preview = append(json.RawMessage(nil), p.Preview...)
	out.Indexes = append([]bson.D(nil), p.Indexes...)
	out.CollectionOptions = cloneBSONMap(p.CollectionOptions)
	return out
}

func cloneBSONMap(in bson.M) bson.M {
	if in == nil {
		return nil
	}
	out := make(bson.M, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func (s *proposalStore) get(id string) (Proposal, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	s.cleanupLocked(time.Now())
	p, ok := s.items[id]
	if !ok {
		return Proposal{}, false
	}
	return cloneProposal(p), true
}

func (s *proposalStore) list() []Proposal {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	s.cleanupLocked(time.Now())
	out := make([]Proposal, 0, len(s.order))
	for i := len(s.order) - 1; i >= 0; i-- {
		if p := s.items[s.order[i]]; p != nil {
			out = append(out, cloneProposal(p))
		}
	}
	return out
}

func (s *proposalStore) remoteCollection() *mongo.Collection {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.coll
}

func (s *proposalStore) cacheDoc(doc proposalDoc) {
	p := proposalFromDoc(doc)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.items[p.ID]; !exists {
		s.order = append(s.order, p.ID)
	}
	s.items[p.ID] = p
}

func (s *proposalStore) remoteUpdate(coll *mongo.Collection, id string, filter bson.M, set bson.M) (*proposalDoc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var doc proposalDoc
	err := coll.FindOneAndUpdate(ctx, filter, bson.M{"$set": set},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

func (s *proposalStore) statusError(id string, action string) error {
	s.refresh()
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.items[id]
	if p == nil {
		return errors.New("proposal not found")
	}
	return fmt.Errorf("proposal is %s; %s", p.Status, action)
}

func (s *proposalStore) approve(id, by string) error {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		doc, err := s.remoteUpdate(coll, id,
			bson.M{"_id": id, "status": ProposalPending},
			bson.M{"status": ProposalApproved, "approvedBy": by, "approvedAt": now, "updatedAt": now})
		if err != nil {
			return err
		}
		if doc == nil {
			return s.statusError(id, "an admin must approve it first")
		}
		s.cacheDoc(*doc)
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	p := s.items[id]
	if p == nil {
		return errors.New("proposal not found")
	}
	if p.Status != ProposalPending {
		return fmt.Errorf("proposal is %s, not pending", p.Status)
	}
	p.Status = ProposalApproved
	p.ApprovedBy = by
	p.ApprovedAt = nowText()
	p.UpdatedAt = p.ApprovedAt
	s.persistLocked(p)
	return nil
}

func (s *proposalStore) reject(id, by string) error {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		doc, err := s.remoteUpdate(coll, id,
			bson.M{"_id": id, "status": bson.M{"$in": []string{ProposalPending, ProposalApproved}}},
			bson.M{"status": ProposalRejected, "rejectedBy": by, "updatedAt": now})
		if err != nil {
			return err
		}
		if doc == nil {
			return s.statusError(id, "it cannot be rejected")
		}
		s.cacheDoc(*doc)
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	p := s.items[id]
	if p == nil {
		return errors.New("proposal not found")
	}
	if p.Status != ProposalPending && p.Status != ProposalApproved {
		return fmt.Errorf("proposal is %s and cannot be rejected", p.Status)
	}
	p.Status = ProposalRejected
	p.RejectedBy = by
	p.UpdatedAt = nowText()
	s.persistLocked(p)
	return nil
}

func (s *proposalStore) claimApply(id string) (Proposal, error) {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		cutoff := time.Now().Add(-proposalApplyTimeout).UTC().Format(time.RFC3339)
		doc, err := s.remoteUpdate(coll, id,
			bson.M{"_id": id, "$or": []bson.M{
				{"status": ProposalApproved},
				{"status": ProposalApplying, "updatedAt": bson.M{"$lt": cutoff}},
			}},
			bson.M{"status": ProposalApplying, "updatedAt": now})
		if err != nil {
			return Proposal{}, err
		}
		if doc == nil {
			return Proposal{}, s.statusError(id, "an admin must approve it first")
		}
		s.cacheDoc(*doc)
		return cloneProposal(proposalFromDoc(*doc)), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	p := s.items[id]
	if p == nil {
		return Proposal{}, errors.New("proposal not found")
	}
	if p.Status != ProposalApproved {
		return Proposal{}, fmt.Errorf("proposal is %s; an admin must approve it first", p.Status)
	}
	p.Status = ProposalApplying
	p.UpdatedAt = nowText()
	s.persistLocked(p)
	return cloneProposal(p), nil
}

func (s *proposalStore) finishApply(id, result string, applyErr error) {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		set := bson.M{"updatedAt": now, "status": ProposalApplied, "appliedAt": now, "result": result, "error": ""}
		if applyErr != nil {
			set = bson.M{"updatedAt": now, "status": ProposalFailed, "error": applyErr.Error()}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := coll.UpdateOne(ctx, bson.M{"_id": id, "status": ProposalApplying}, bson.M{"$set": set})
		cancel()
		if err != nil {
			log.Printf("proposal store: finish apply %s: %v", id, err)
		}
		s.refresh()
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.items[id]
	if p == nil {
		return
	}
	p.UpdatedAt = nowText()
	if applyErr != nil {
		p.Status = ProposalFailed
		p.Error = applyErr.Error()
		s.persistLocked(p)
		return
	}
	p.Status = ProposalApplied
	p.AppliedAt = p.UpdatedAt
	p.Result = result
	p.Error = ""
	s.persistLocked(p)
}

func (s *proposalStore) claimRollback(id string) (Proposal, error) {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		doc, err := s.remoteUpdate(coll, id,
			bson.M{"_id": id, "status": ProposalApplied},
			bson.M{"status": ProposalApplying, "updatedAt": now})
		if err != nil {
			return Proposal{}, err
		}
		if doc == nil {
			return Proposal{}, s.statusError(id, "it cannot be rolled back")
		}
		if !doc.Rollbackable || (len(doc.Snapshot) == 0 && doc.Operation != "drop_collection") {
			// Put it back so a failed rollback claim does not strand the
			// proposal in applying.
			_, _ = s.remoteUpdate(coll, id, bson.M{"_id": id, "status": ProposalApplying},
				bson.M{"status": ProposalApplied, "updatedAt": doc.UpdatedAt})
			return Proposal{}, errors.New("this proposal has no rollback snapshot")
		}
		s.cacheDoc(*doc)
		return cloneProposal(proposalFromDoc(*doc)), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked()
	p := s.items[id]
	if p == nil {
		return Proposal{}, errors.New("proposal not found")
	}
	if p.Status != ProposalApplied {
		return Proposal{}, fmt.Errorf("proposal is %s and cannot be rolled back", p.Status)
	}
	if !p.Rollbackable || (len(p.Snapshot) == 0 && p.Operation != "drop_collection") {
		return Proposal{}, errors.New("this proposal has no rollback snapshot")
	}
	p.Status = ProposalApplying
	p.UpdatedAt = nowText()
	s.persistLocked(p)
	return cloneProposal(p), nil
}

func (s *proposalStore) finishRollback(id string, rollbackErr error) {
	if coll := s.remoteCollection(); coll != nil {
		now := nowText()
		set := bson.M{"updatedAt": now, "status": ProposalRolledBack, "rolledBackAt": now, "error": ""}
		if rollbackErr != nil {
			set = bson.M{"updatedAt": now, "status": ProposalFailed, "error": rollbackErr.Error()}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := coll.UpdateOne(ctx, bson.M{"_id": id, "status": ProposalApplying}, bson.M{"$set": set})
		cancel()
		if err != nil {
			log.Printf("proposal store: finish rollback %s: %v", id, err)
		}
		s.refresh()
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.items[id]
	if p == nil {
		return
	}
	p.UpdatedAt = nowText()
	if rollbackErr != nil {
		p.Status = ProposalFailed
		p.Error = rollbackErr.Error()
		s.persistLocked(p)
		return
	}
	p.Status = ProposalRolledBack
	p.RolledBackAt = p.UpdatedAt
	p.Error = ""
	s.persistLocked(p)
}

// --- server proposal lifecycle ---------------------------------------------

func (s *Server) Proposals() []Proposal { return s.proposals.list() }

func (s *Server) Proposal(id string) (Proposal, bool) { return s.proposals.get(id) }

func (s *Server) ApproveProposal(id, by string) error { return s.proposals.approve(id, by) }

func (s *Server) RejectProposal(id, by string) error { return s.proposals.reject(id, by) }

func (s *Server) ApplyProposal(id string) (string, error) {
	p, err := s.proposals.claimApply(id)
	if err != nil {
		return "", err
	}
	result, applyErr := s.executeProposal(p)
	s.proposals.finishApply(id, result, applyErr)
	if applyErr != nil {
		return "", applyErr
	}
	return result, nil
}

func (s *Server) RollbackProposal(id string) error {
	p, err := s.proposals.claimRollback(id)
	if err != nil {
		return err
	}
	rollbackErr := s.executeRollback(p)
	s.proposals.finishRollback(id, rollbackErr)
	return rollbackErr
}

func (s *Server) executeProposal(p Proposal) (string, error) {
	switch p.Operation {
	case "update", "delete", "drop_collection":
		coll, err := targetFrom(s, p.ConnectionID, p.Args)
		if err != nil {
			return "", err
		}
		filter := bson.D{}
		if p.Operation != "drop_collection" {
			if filter, err = toBSON(p.Args["filter"]); err != nil {
				return "", err
			}
		}
		ctx, cancel := opCtx()
		defer cancel()
		current, err := coll.CountDocuments(ctx, filter)
		if err != nil {
			return "", err
		}
		if current != p.Matches {
			return "", fmt.Errorf("proposal is stale: %d matching documents when proposed, %d now; create a new proposal", p.Matches, current)
		}
		if p.SampleHash != "" {
			limit := int64(proposalSnapshotMax + 1)
			many := argBool(p.Args, "many", false)
			if p.Operation != "drop_collection" && !many {
				limit = 1
			}
			sample, err := proposalSample(ctx, coll, filter, limit)
			if err != nil {
				return "", err
			}
			if hashProposalDocs(sample) != p.SampleHash {
				return "", errors.New("proposal is stale: matching documents changed since the preview; create a new proposal")
			}
		}
		// A single-document update/delete must hit the exact document shown in
		// the preview, not an arbitrary matching document.
		if p.Operation != "drop_collection" && !argBool(p.Args, "many", false) && p.TargetID != nil {
			combined, err := proposalTargetFilter(p.Args["filter"], p.TargetID)
			if err != nil {
				return "", err
			}
			p.Args = cloneMap(p.Args)
			p.Args["filter"] = combined
		}
	case "drop_database":
		client, err := s.client(p.ConnectionID)
		if err != nil {
			return "", err
		}
		ctx, cancel := opCtx()
		defer cancel()
		names, err := client.Database(p.Database).ListCollectionNames(ctx, bson.M{})
		if err != nil {
			return "", err
		}
		sort.Strings(names)
		if int64(len(names)) != p.Matches || (p.SampleHash != "" && hashProposalNames(names) != p.SampleHash) {
			return "", errors.New("proposal is stale: the database's collection set changed since the preview; create a new proposal")
		}
	}
	for _, t := range tools {
		if t.name != p.Tool {
			continue
		}
		args := cloneMap(p.Args)
		delete(args, "propose")
		return t.run(s, args)
	}
	return "", fmt.Errorf("unknown proposal tool %q", p.Tool)
}

func proposalSample(ctx context.Context, coll *mongo.Collection, filter bson.D, limit int64) ([]bson.D, error) {
	cursor, err := coll.Find(ctx, filter, options.Find().
		SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var docs []bson.D
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	return docs, nil
}

func proposalTargetFilter(raw any, id any) (any, error) {
	original, err := toJSON(raw)
	if err != nil {
		return nil, err
	}
	target, err := toJSON(map[string]any{"_id": id})
	if err != nil {
		return nil, err
	}
	return map[string]any{"$and": []any{json.RawMessage(original), json.RawMessage(target)}}, nil
}

func hashProposalDocs(docs []bson.D) string {
	if len(docs) == 0 {
		return ""
	}
	hash := sha256.New()
	for _, doc := range docs {
		raw, err := bson.MarshalExtJSON(doc, false, false)
		if err != nil {
			continue
		}
		_, _ = hash.Write([]byte(strconv.Itoa(len(raw))))
		_, _ = hash.Write([]byte(":"))
		_, _ = hash.Write(raw)
		_, _ = hash.Write([]byte("\n"))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func hashProposalNames(names []string) string {
	hash := sha256.New()
	for _, name := range names {
		_, _ = hash.Write([]byte(name))
		_, _ = hash.Write([]byte("\n"))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func collectionRollbackMeta(ctx context.Context, coll *mongo.Collection) (bson.M, []bson.D, bool) {
	cursor, err := coll.Database().ListCollections(ctx, bson.M{"name": coll.Name()})
	if err != nil {
		return nil, nil, false
	}
	defer cursor.Close(ctx)
	var spec bson.M
	if !cursor.Next(ctx) {
		return nil, nil, false
	}
	if err := cursor.Decode(&spec); err != nil {
		return nil, nil, false
	}
	meta := bson.M{}
	switch optionsValue := spec["options"].(type) {
	case bson.M:
		meta = optionsValue
	case map[string]any:
		meta = bson.M(optionsValue)
	}
	indexCursor, err := coll.Indexes().List(ctx)
	if err != nil {
		return nil, nil, false
	}
	defer indexCursor.Close(ctx)
	var indexes []bson.D
	if err := indexCursor.All(ctx, &indexes); err != nil {
		return nil, nil, false
	}
	return meta, indexes, true
}

func (s *Server) executeRollback(p Proposal) error {
	coll, err := targetFrom(s, p.ConnectionID, p.Args)
	if err != nil {
		return err
	}
	ctx, cancel := opCtx()
	defer cancel()
	if p.Operation == "drop_collection" && p.Rollbackable {
		client := coll.Database().Client()
		names, err := client.Database(p.Database).ListCollectionNames(ctx, bson.M{"name": p.Collection})
		if err != nil {
			return err
		}
		if len(names) == 0 {
			cmd := bson.D{{Key: "create", Value: p.Collection}}
			for key, value := range p.CollectionOptions {
				cmd = append(cmd, bson.E{Key: key, Value: value})
			}
			if err := client.Database(p.Database).RunCommand(ctx, cmd).Err(); err != nil {
				return err
			}
		}
	}
	for _, doc := range p.Snapshot {
		id, ok := doc.Map()["_id"]
		if !ok {
			return errors.New("snapshot document has no _id")
		}
		if _, err := coll.ReplaceOne(ctx, bson.D{{Key: "_id", Value: id}}, doc, options.Replace().SetUpsert(true)); err != nil {
			return err
		}
	}
	if p.Operation == "drop_collection" && p.Rollbackable && len(p.Indexes) > 0 {
		indexes := make(bson.A, 0, len(p.Indexes))
		for _, spec := range p.Indexes {
			name, _ := spec.Map()["name"].(string)
			if name == "_id_" {
				continue
			}
			clean := bson.D{}
			for _, e := range spec {
				if e.Key == "v" || e.Key == "ns" {
					continue
				}
				clean = append(clean, e)
			}
			indexes = append(indexes, clean)
		}
		if len(indexes) > 0 {
			cmd := bson.D{
				{Key: "createIndexes", Value: p.Collection},
				{Key: "indexes", Value: indexes},
			}
			if err := clientForColl(coll).Database(p.Database).RunCommand(ctx, cmd).Err(); err != nil {
				return err
			}
		}
	}
	return nil
}

func clientForColl(coll *mongo.Collection) *mongo.Client {
	return coll.Database().Client()
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// createProposal builds a preview and stores the original arguments for a
// later admin-approved apply. It is called by write tools when propose=true.
func (s *Server) createProposal(tool string, args map[string]any) (string, error) {
	connectionID, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(connectionID); err != nil {
		return "", err
	}
	database, err := argStr(args, "database")
	if err != nil {
		return "", err
	}
	operation := proposalOperation(tool)
	if operation == "" {
		return "", fmt.Errorf("tool %q does not support proposals", tool)
	}
	storedArgs := cloneMap(args)
	delete(storedArgs, "propose")
	delete(storedArgs, "_actor")
	delete(storedArgs, "_allowedConnections")
	createdBy := argStrDefault(args, "_actor", "mcp")

	ctx, cancel := opCtx()
	defer cancel()

	var (
		count             int64
		matches           int64
		snapshot          []bson.D
		sample            []bson.D
		rollbackable      bool
		preview           map[string]any
		summary           string
		targetID          any
		sampleHash        string
		collectionOptions bson.M
		indexes           []bson.D
	)
	if operation == "drop_database" {
		client, err := s.client(connectionID)
		if err != nil {
			return "", err
		}
		names, err := client.Database(database).ListCollectionNames(ctx, bson.M{})
		if err != nil {
			return "", err
		}
		sort.Strings(names)
		count = int64(len(names))
		matches = count
		sampleHash = hashProposalNames(names)
		preview = map[string]any{
			"operation":   "drop_database",
			"count":       count,
			"collections": names,
		}
		summary = fmt.Sprintf("Drop database %s with %d collection(s)", database, count)
	} else {
		collection, err := argStr(args, "collection")
		if err != nil {
			return "", err
		}
		coll, err := targetFrom(s, connectionID, args)
		if err != nil {
			return "", err
		}
		switch operation {
		case "insert":
			docs, err := toBSONDocs(args["documents"])
			if err != nil {
				return "", err
			}
			if len(docs) == 0 {
				return "", fmt.Errorf("documents must be a non-empty array")
			}
			count = int64(len(docs))
			sample = docs[:int(minInt64(int64(len(docs)), proposalPreviewMax))]
			preview = map[string]any{"operation": "insert", "count": count, "documents": sample}
			summary = fmt.Sprintf("Insert %d document(s) into %s.%s", count, database, collection)

		case "update", "delete", "drop_collection":
			filter := bson.D{}
			if operation != "drop_collection" {
				rawFilter, ok := argObject(args, "filter")
				if !ok {
					return "", fmt.Errorf("missing required argument: filter")
				}
				if filter, err = toBSON(rawFilter); err != nil {
					return "", err
				}
			}
			many := argBool(args, "many", false)
			upsert := operation == "update" && argBool(args, "upsert", false)
			matches, err = coll.CountDocuments(ctx, filter)
			if err != nil {
				return "", err
			}
			if operation != "drop_collection" && matches == 0 && !upsert {
				return "", fmt.Errorf("no documents match this filter")
			}
			limit := int64(proposalSnapshotMax + 1)
			if operation == "drop_collection" {
				limit = proposalSnapshotMax + 1
			} else if !many {
				limit = 1
			}
			metaCaptured := false
			if matches > 0 {
				cursor, err := coll.Find(ctx, filter, options.Find().
					SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(limit))
				if err != nil {
					return "", err
				}
				if err := cursor.All(ctx, &sample); err != nil {
					_ = cursor.Close(ctx)
					return "", err
				}
				_ = cursor.Close(ctx)
				sampleHash = hashProposalDocs(sample)
			}
			count = matches
			if operation != "drop_collection" && !many && matches > 0 {
				count = 1
				if len(sample) > 0 {
					targetID = sample[0].Map()["_id"]
				}
			}
			if operation == "drop_collection" {
				collectionOptions, indexes, metaCaptured = collectionRollbackMeta(ctx, coll)
			}
			previewDocs := sample
			if int64(len(previewDocs)) > proposalPreviewMax {
				previewDocs = previewDocs[:proposalPreviewMax]
			}
			switch operation {
			case "drop_collection":
				rollbackable = metaCaptured && count <= proposalSnapshotMax
			default:
				rollbackable = count > 0 && int64(len(sample)) >= count
			}
			if rollbackable && len(sample) > 0 {
				snapshot = append([]bson.D(nil), sample...)
			}
			preview = map[string]any{
				"operation":    operation,
				"count":        count,
				"matches":      matches,
				"filter":       args["filter"],
				"many":         many,
				"sample":       previewDocs,
				"rollbackable": rollbackable,
			}
			if operation == "update" {
				preview["update"] = args["update"]
				preview["upsert"] = upsert
				summary = fmt.Sprintf("Update %d document(s) in %s.%s", count, database, collection)
			} else if operation == "delete" {
				summary = fmt.Sprintf("Delete %d document(s) from %s.%s", count, database, collection)
			} else {
				summary = fmt.Sprintf("Drop collection %s.%s with %d document(s)", database, collection, count)
			}

		case "create_collection":
			preview = map[string]any{
				"operation":  "create_collection",
				"collection": collection,
				"capped":     args["capped"],
				"size":       args["size"],
				"max":        args["max"],
			}
			summary = fmt.Sprintf("Create collection %s.%s", database, collection)

		case "create_index":
			preview = map[string]any{
				"operation":  "create_index",
				"collection": collection,
				"keys":       args["keys"],
				"options":    args["options"],
			}
			summary = fmt.Sprintf("Create index on %s.%s", database, collection)

		case "drop_index":
			preview = map[string]any{
				"operation":  "drop_index",
				"collection": collection,
				"name":       args["name"],
			}
			summary = fmt.Sprintf("Drop index %v on %s.%s", args["name"], database, collection)

		case "aggregate":
			preview = map[string]any{
				"operation":  "aggregate",
				"collection": collection,
				"pipeline":   args["pipeline"],
			}
			summary = fmt.Sprintf("Run terminal aggregation on %s.%s", database, collection)
		}
	}
	rawPreview, err := toJSON(preview)
	if err != nil {
		return "", err
	}
	proposalValue := Proposal{
		Tool:              tool,
		Operation:         operation,
		ConnectionID:      connectionID,
		Database:          database,
		Collection:        argStrDefault(args, "collection", ""),
		Summary:           summary,
		Count:             count,
		Matches:           matches,
		Rollbackable:      rollbackable,
		Preview:           rawPreview,
		CreatedBy:         createdBy,
		Args:              storedArgs,
		Snapshot:          snapshot,
		TargetID:          targetID,
		SampleHash:        sampleHash,
		CollectionOptions: collectionOptions,
		Indexes:           indexes,
	}
	encoded, err := bson.Marshal(proposalToDoc(&proposalValue))
	if err != nil {
		return "", fmt.Errorf("cannot encode proposal: %w", err)
	}
	if len(encoded) > proposalMaxDocBytes {
		return "", fmt.Errorf("proposal is too large to persist (%d bytes); reduce the documents or snapshot size", len(encoded))
	}
	proposal := s.proposals.create(&proposalValue)
	return jsonStd(map[string]any{
		"proposal": proposal,
		"message":  "Write preview created. An administrator must approve it before it can be applied.",
	})
}

func proposalOperation(tool string) string {
	switch tool {
	case "mongoui_insert":
		return "insert"
	case "mongoui_update":
		return "update"
	case "mongoui_delete":
		return "delete"
	case "mongoui_create_collection":
		return "create_collection"
	case "mongoui_drop_collection":
		return "drop_collection"
	case "mongoui_drop_database":
		return "drop_database"
	case "mongoui_create_index":
		return "create_index"
	case "mongoui_drop_index":
		return "drop_index"
	case "mongoui_aggregate":
		return "aggregate"
	default:
		return ""
	}
}
