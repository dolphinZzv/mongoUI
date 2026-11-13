package mcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
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
	mu    sync.Mutex
	items map[string]*Proposal
	order []string
}

func newProposalStore() *proposalStore {
	return &proposalStore{items: map[string]*Proposal{}}
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
	}
	p.ID = "prop_" + randomToken()
	p.Status = ProposalPending
	p.CreatedAt = now.UTC().Format(time.RFC3339)
	p.UpdatedAt = p.CreatedAt
	s.items[p.ID] = p
	s.order = append(s.order, p.ID)
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
	return nil
}

func (s *proposalStore) reject(id, by string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	return nil
}

func (s *proposalStore) claimApply(id string) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.items[id]
	if p == nil {
		return Proposal{}, errors.New("proposal not found")
	}
	if p.Status != ProposalApproved {
		return Proposal{}, fmt.Errorf("proposal is %s; an admin must approve it first", p.Status)
	}
	p.Status = ProposalApplying
	p.UpdatedAt = nowText()
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
		return
	}
	p.Status = ProposalApplied
	p.AppliedAt = p.UpdatedAt
	p.Result = result
	p.Error = ""
}

func (s *proposalStore) claimRollback(id string) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
		return
	}
	p.Status = ProposalRolledBack
	p.RolledBackAt = p.UpdatedAt
	p.Error = ""
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
	if p.Operation != "insert" {
		coll, err := targetFrom(s, p.ConnectionID, p.Args)
		if err != nil {
			return "", err
		}
		filter, err := toBSON(p.Args["filter"])
		if err != nil {
			return "", err
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
// later admin-approved apply. It is called by the write tools when propose=true.
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
	collection, err := argStr(args, "collection")
	if err != nil {
		return "", err
	}
	coll, err := targetFrom(s, connectionID, args)
	if err != nil {
		return "", err
	}

	operation := "update"
	switch tool {
	case "mongoui_insert":
		operation = "insert"
	case "mongoui_delete":
		operation = "delete"
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
		preview = map[string]any{
			"operation": "insert",
			"count":     count,
			"documents": sample,
		}
		summary = fmt.Sprintf("Insert %d document(s) into %s.%s", count, database, collection)
	default:
		rawFilter, ok := argObject(args, "filter")
		if !ok {
			return "", fmt.Errorf("missing required argument: filter")
		}
		filter, err := toBSON(rawFilter)
		if err != nil {
			return "", err
		}
		many := argBool(args, "many", false)
		upsert := operation == "update" && argBool(args, "upsert", false)
		matches, err = coll.CountDocuments(ctx, filter)
		if err != nil {
			return "", err
		}
		if matches == 0 && !upsert {
			return "", fmt.Errorf("no documents match this filter")
		}
		limit := int64(proposalSnapshotMax + 1)
		if !many {
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
		if !many && matches > 0 {
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
		} else {
			summary = fmt.Sprintf("Delete %d document(s) from %s.%s", count, database, collection)
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
		Collection:   collection,
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
