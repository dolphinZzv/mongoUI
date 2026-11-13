package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type copyRequest struct {
	TargetConnectionID string            `json:"targetConnectionId"`
	TargetDatabase     string            `json:"targetDatabase"`
	TargetCollection   string            `json:"targetCollection"`
	Filter             json.RawMessage   `json:"filter"`
	DropTarget         bool              `json:"dropTarget"`
	CopyIndexes        bool              `json:"copyIndexes"`
	Verify             *bool             `json:"verify"`
	FieldMap           map[string]string `json:"fieldMap"`
	ExcludeFields      []string          `json:"excludeFields"`
}

// transformDocument renames fields via fieldMap and drops excluded top-level
// fields before a document is written to the target.
func transformDocument(doc bson.D, fieldMap map[string]string, exclude map[string]bool) bson.D {
	if len(fieldMap) == 0 && len(exclude) == 0 {
		return doc
	}
	out := make(bson.D, 0, len(doc))
	for _, element := range doc {
		if exclude[element.Key] {
			continue
		}
		key := element.Key
		if mapped, ok := fieldMap[key]; ok && mapped != "" {
			key = mapped
		}
		out = append(out, bson.E{Key: key, Value: element.Value})
	}
	return out
}

// copyCollection copies documents (optionally filtered) from one collection to
// another. The target may live in another database or connection, and fields
// can be renamed or dropped on the way.
func (a *API) copyCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	src, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req copyRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	req.TargetDatabase = strings.TrimSpace(req.TargetDatabase)
	req.TargetCollection = strings.TrimSpace(req.TargetCollection)
	if req.TargetDatabase == "" || req.TargetCollection == "" {
		badRequest(w, errors.New("targetDatabase and targetCollection are required"))
		return
	}
	if req.TargetDatabase == src.Database().Name() && req.TargetCollection == src.Name() {
		badRequest(w, errors.New("source and target are the same collection"))
		return
	}
	filter, err := parseExtJSOND(string(req.Filter))
	if err != nil {
		badRequest(w, err)
		return
	}

	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	targetClient := client
	if targetConnectionID := strings.TrimSpace(req.TargetConnectionID); targetConnectionID != "" &&
		targetConnectionID != chi.URLParam(r, "id") {
		if !a.requireWritableConnection(w, r, targetConnectionID) {
			return
		}
		targetClient, err = a.mgr.Get(targetConnectionID)
		if err != nil {
			a.dbErr(w, err)
			return
		}
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	target := targetClient.Database(req.TargetDatabase).Collection(req.TargetCollection)
	excludeSet := make(map[string]bool, len(req.ExcludeFields))
	for _, field := range req.ExcludeFields {
		if trimmed := strings.TrimSpace(field); trimmed != "" {
			excludeSet[trimmed] = true
		}
	}
	if req.DropTarget {
		if err := target.Drop(ctx); err != nil && !isNamespaceNotFound(err) {
			a.dbErr(w, err)
			return
		}
	}

	cursor, err := src.Find(ctx, filter, options.Find().SetBatchSize(500))
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	const batchSize = 1000
	var copied int
	batch := make([]any, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if _, err := target.InsertMany(ctx, batch); err != nil {
			return err
		}
		copied += len(batch)
		batch = batch[:0]
		return nil
	}

	for cursor.Next(ctx) {
		var doc bson.D
		if err := cursor.Decode(&doc); err != nil {
			a.dbErr(w, err)
			return
		}
		batch = append(batch, transformDocument(doc, req.FieldMap, excludeSet))
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				a.dbErr(w, err)
				return
			}
		}
	}
	if err := cursor.Err(); err != nil {
		a.dbErr(w, err)
		return
	}
	if err := flush(); err != nil {
		a.dbErr(w, err)
		return
	}

	payload := map[string]any{
		"copied":           copied,
		"targetDatabase":   req.TargetDatabase,
		"targetCollection": req.TargetCollection,
	}
	if req.Verify == nil || *req.Verify {
		verification, err := verifyCopy(ctx, src, target, filter, req.FieldMap, excludeSet)
		if err != nil {
			payload["verification"] = map[string]any{"ok": false, "error": err.Error()}
		} else {
			payload["verification"] = verification
		}
	}
	if req.CopyIndexes {
		n, warnings := copyIndexes(ctx, src, target)
		payload["indexesCopied"] = n
		if len(warnings) > 0 {
			payload["warnings"] = warnings
		}
	}
	ok(w, payload)
}

type copyVerification struct {
	OK          bool   `json:"ok"`
	SourceCount int64  `json:"sourceCount"`
	TargetCount int64  `json:"targetCount"`
	CountMatch  bool   `json:"countMatch"`
	Sampled     int    `json:"sampled"`
	SampleMatch bool   `json:"sampleMatch"`
	SourceHash  string `json:"sourceHash,omitempty"`
	TargetHash  string `json:"targetHash,omitempty"`
}

const copyVerificationSample = 100

// verifyCopy compares counts and a deterministic _id-ordered sample of source
// (after field transforms) against the target. It is a strong smoke test, not a
// byte-for-byte cluster sync.
func verifyCopy(
	ctx context.Context,
	src, target *mongo.Collection,
	filter bson.D,
	fieldMap map[string]string,
	exclude map[string]bool,
) (copyVerification, error) {
	sourceCount, err := src.CountDocuments(ctx, filter)
	if err != nil {
		return copyVerification{}, err
	}
	targetCount, err := target.CountDocuments(ctx, bson.D{})
	if err != nil {
		return copyVerification{}, err
	}
	sourceHash, sampled, err := copySampleHash(ctx, src, filter, func(doc bson.D) bson.D {
		return transformDocument(doc, fieldMap, exclude)
	})
	if err != nil {
		return copyVerification{}, err
	}
	targetHash, _, err := copySampleHash(ctx, target, bson.D{}, func(doc bson.D) bson.D { return doc })
	if err != nil {
		return copyVerification{}, err
	}
	return copyVerification{
		OK:          sourceHash == targetHash && sourceCount == targetCount,
		SourceCount: sourceCount,
		TargetCount: targetCount,
		CountMatch:  sourceCount == targetCount,
		Sampled:     sampled,
		SampleMatch: sourceHash == targetHash,
		SourceHash:  sourceHash,
		TargetHash:  targetHash,
	}, nil
}

func copySampleHash(
	ctx context.Context,
	coll *mongo.Collection,
	filter bson.D,
	transform func(bson.D) bson.D,
) (string, int, error) {
	opts := options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(copyVerificationSample)
	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		return "", 0, err
	}
	defer cursor.Close(ctx)
	hash := sha256.New()
	count := 0
	for cursor.Next(ctx) {
		var doc bson.D
		if err := cursor.Decode(&doc); err != nil {
			return "", count, err
		}
		raw, err := bson.MarshalExtJSON(transform(doc), false, false)
		if err != nil {
			return "", count, err
		}
		_, _ = hash.Write([]byte(strconv.Itoa(len(raw))))
		_, _ = hash.Write([]byte(":"))
		_, _ = hash.Write(raw)
		_, _ = hash.Write([]byte("\n"))
		count++
	}
	if err := cursor.Err(); err != nil {
		return "", count, err
	}
	return hex.EncodeToString(hash.Sum(nil)), count, nil
}

// copyIndexes recreates the non-default indexes of src on target. Index specs
// are replayed verbatim through createIndexes so every option is preserved.
func copyIndexes(ctx context.Context, src, target *mongo.Collection) (int, []string) {
	cursor, err := src.Indexes().List(ctx)
	if err != nil {
		return 0, []string{err.Error()}
	}
	defer cursor.Close(ctx)

	var specs []bson.D
	if err := cursor.All(ctx, &specs); err != nil {
		return 0, []string{err.Error()}
	}

	indexes := bson.A{}
	for _, spec := range specs {
		if name, ok := spec.Map()["name"].(string); ok && name == "_id_" {
			continue
		}
		clean := bson.D{}
		for _, e := range spec {
			// v is the index format version and ns is the source namespace;
			// both are managed by the server on the target.
			if e.Key == "v" || e.Key == "ns" {
				continue
			}
			clean = append(clean, e)
		}
		indexes = append(indexes, clean)
	}
	if len(indexes) == 0 {
		return 0, nil
	}

	cmd := bson.D{
		{Key: "createIndexes", Value: target.Name()},
		{Key: "indexes", Value: indexes},
	}
	if err := target.Database().RunCommand(ctx, cmd).Err(); err != nil {
		return 0, []string{err.Error()}
	}
	return len(indexes), nil
}

// isNamespaceNotFound reports whether an error is a "collection/db missing"
// error, which is safe to ignore when dropping before a copy/restore.
func isNamespaceNotFound(err error) bool {
	if err == nil {
		return false
	}
	var cmdErr mongo.CommandError
	if errors.As(err, &cmdErr) && cmdErr.Code == 26 { // NamespaceNotFound
		return true
	}
	return strings.Contains(err.Error(), "ns not found")
}

type explainRequest struct {
	Type       string          `json:"type"`
	Filter     json.RawMessage `json:"filter"`
	Sort       json.RawMessage `json:"sort"`
	Projection json.RawMessage `json:"projection"`
	Pipeline   json.RawMessage `json:"pipeline"`
	Skip       int64           `json:"skip"`
	Limit      int64           `json:"limit"`
	Verbosity  string          `json:"verbosity"`
}

// explain runs the explain command for a find query or an aggregation pipeline
// and returns the raw plan document for visualisation in the UI.
func (a *API) explain(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req explainRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	verbosity := strings.TrimSpace(req.Verbosity)
	switch verbosity {
	case "":
		verbosity = "queryPlanner"
	case "queryPlanner", "executionStats", "allPlansExecution":
	default:
		badRequest(w, errors.New("verbosity must be queryPlanner, executionStats or allPlansExecution"))
		return
	}

	var target bson.D
	switch strings.ToLower(strings.TrimSpace(req.Type)) {
	case "", "find":
		filter, err := parseExtJSOND(string(req.Filter))
		if err != nil {
			badRequest(w, err)
			return
		}
		sortDoc, err := parseExtJSOND(string(req.Sort))
		if err != nil {
			badRequest(w, err)
			return
		}
		proj, err := parseExtJSOND(string(req.Projection))
		if err != nil {
			badRequest(w, err)
			return
		}
		target = bson.D{{Key: "find", Value: coll.Name()}}
		if len(filter) > 0 {
			target = append(target, bson.E{Key: "filter", Value: filter})
		}
		if len(sortDoc) > 0 {
			target = append(target, bson.E{Key: "sort", Value: sortDoc})
		}
		if len(proj) > 0 {
			target = append(target, bson.E{Key: "projection", Value: proj})
		}
		if req.Skip > 0 {
			target = append(target, bson.E{Key: "skip", Value: req.Skip})
		}
		if req.Limit > 0 {
			target = append(target, bson.E{Key: "limit", Value: req.Limit})
		}
	case "aggregate":
		stages, err := parsePipeline(req.Pipeline)
		if err != nil {
			badRequest(w, err)
			return
		}
		target = bson.D{
			{Key: "aggregate", Value: coll.Name()},
			{Key: "pipeline", Value: stages},
			{Key: "cursor", Value: bson.D{}},
		}
	default:
		badRequest(w, errors.New(`type must be "find" or "aggregate"`))
		return
	}

	cmd := bson.D{
		{Key: "explain", Value: target},
		{Key: "verbosity", Value: verbosity},
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	var res bson.D
	if err := coll.Database().RunCommand(ctx, cmd).Decode(&res); err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(res)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, raw)
}

// parsePipeline parses an Extended JSON aggregation pipeline. A missing or null
// pipeline yields an empty pipeline.
func parsePipeline(raw json.RawMessage) ([]bson.D, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return []bson.D{}, nil
	}
	var stages []bson.D
	if err := bson.UnmarshalExtJSON([]byte(s), false, &stages); err != nil {
		return nil, errors.New("invalid pipeline: " + err.Error())
	}
	if stages == nil {
		stages = []bson.D{}
	}
	return stages, nil
}
