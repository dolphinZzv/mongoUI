package mcp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/config"
)

const (
	proposalTTL         = 30 * time.Minute
	proposalMax         = 100
	proposalSnapshotMax = 100
	proposalPreviewMax  = 5
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
	ID           string   `bson:"_id"`
	Tool         string   `bson:"tool"`
	Operation    string   `bson:"operation"`
	ConnectionID string   `bson:"connectionId"`
	Database     string   `bson:"database"`
	Collection   string   `bson:"collection"`
	Summary      string   `bson:"summary"`
	Count        int64    `bson:"count"`
	Matches      int64    `bson:"matches"`
	Rollbackable bool     `bson:"rollbackable"`
	Preview      string   `bson:"preview"`
	Status       string   `bson:"status"`
	CreatedBy    string   `bson:"createdBy,omitempty"`
	CreatedAt    string   `bson:"createdAt"`
	UpdatedAt    string   `bson:"updatedAt"`
	ApprovedBy   string   `bson:"approvedBy,omitempty"`
	ApprovedAt   string   `bson:"approvedAt,omitempty"`
	RejectedBy   string   `bson:"rejectedBy,omitempty"`
	AppliedAt    string   `bson:"appliedAt,omitempty"`
	RolledBackAt string   `bson:"rolledBackAt,omitempty"`
	Error        string   `bson:"error,omitempty"`
	Result       string   `bson:"result,omitempty"`
	Args         bson.M   `bson:"args"`
	Snapshot     []bson.D `bson:"snapshot,omitempty"`
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
		Args: bson.M(p.Args), Snapshot: p.Snapshot,
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
		Args: map[string]any(d.Args), Snapshot: d.Snapshot,
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

func (s *proposalStore) approve(id, by string) error {
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
	if !p.Rollbackable || len(p.Snapshot) == 0 {
		return Proposal{}, errors.New("this proposal has no rollback snapshot")
	}
	p.Status = ProposalApplying
	p.UpdatedAt = nowText()
	s.persistLocked(p)
	return cloneProposal(p), nil
}

func (s *proposalStore) finishRollback(id string, rollbackErr error) {
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

func (s *Server) executeRollback(p Proposal) error {
	coll, err := targetFrom(s, p.ConnectionID, p.Args)
	if err != nil {
		return err
	}
	ctx, cancel := opCtx()
	defer cancel()
	for _, doc := range p.Snapshot {
		id, ok := doc.Map()["_id"]
		if !ok {
			return errors.New("snapshot document has no _id")
		}
		if _, err := coll.ReplaceOne(ctx, bson.D{{Key: "_id", Value: id}}, doc, options.Replace().SetUpsert(true)); err != nil {
			return err
		}
	}
	return nil
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

	ctx, cancel := opCtx()
	defer cancel()

	var (
		count        int64
		matches      int64
		snapshot     []bson.D
		sample       []bson.D
		rollbackable bool
		preview      map[string]any
		summary      string
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
		count = int64(len(names))
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
			if matches > 0 {
				cursor, err := coll.Find(ctx, filter, options.Find().SetLimit(limit))
				if err != nil {
					return "", err
				}
				if err := cursor.All(ctx, &sample); err != nil {
					_ = cursor.Close(ctx)
					return "", err
				}
				_ = cursor.Close(ctx)
			}
			count = matches
			if operation != "drop_collection" && !many && matches > 0 {
				count = 1
			}
			previewDocs := sample
			if int64(len(previewDocs)) > proposalPreviewMax {
				previewDocs = previewDocs[:proposalPreviewMax]
			}
			rollbackable = count > 0 && int64(len(sample)) >= count
			if rollbackable {
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
	proposal := s.proposals.create(&Proposal{
		Tool:         tool,
		Operation:    operation,
		ConnectionID: connectionID,
		Database:     database,
		Collection:   argStrDefault(args, "collection", ""),
		Summary:      summary,
		Count:        count,
		Matches:      matches,
		Rollbackable: rollbackable,
		Preview:      rawPreview,
		CreatedBy:    "mcp",
		Args:         storedArgs,
		Snapshot:     snapshot,
	})
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
