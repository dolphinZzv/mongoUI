package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type findRequest struct {
	Filter     json.RawMessage `json:"filter"`
	Sort       json.RawMessage `json:"sort"`
	Projection json.RawMessage `json:"projection"`
	Skip       int64           `json:"skip"`
	Limit      int64           `json:"limit"`
	// IncludeTotal defaults to true. Pagination can disable it after the first
	// page so deep navigation never pays for another countDocuments.
	IncludeTotal *bool `json:"includeTotal"`
	// After / Before are exclusive _id cursors (Extended JSON values). They are
	// honoured only for a plain {_id: 1} / {_id: -1} sort; arbitrary sorts fall
	// back to skip/limit.
	After  json.RawMessage `json:"after"`
	Before json.RawMessage `json:"before"`
}

type countResult struct {
	total     int64
	estimated bool
	err       error
}

func (a *API) findDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req findRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

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

	limit := req.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	skip := req.Skip
	if skip < 0 {
		skip = 0
	}

	includeTotal := true
	if req.IncludeTotal != nil {
		includeTotal = *req.IncludeTotal
	}

	after, err := parseOptionalExtJSONValue(req.After)
	if err != nil {
		badRequest(w, err)
		return
	}
	before, err := parseOptionalExtJSONValue(req.Before)
	if err != nil {
		badRequest(w, err)
		return
	}
	idDirection := idSortDirection(sortDoc)
	useCursor := idDirection != 0 && (after != nil || before != nil)
	queryFilter := filter
	querySort := sortDoc
	reverse := false
	if useCursor {
		queryFilter = applyIDRange(filter, after, before, idDirection)
		// "before" asks for the page above the cursor. Query in the opposite
		// direction so the extra row tells us whether an even earlier page exists,
		// then restore the natural order before returning.
		if before != nil && after == nil {
			reverse = true
			querySort = bson.D{{Key: "_id", Value: -idDirection}}
		}
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	start := time.Now()
	countCh := make(chan countResult, 1)
	if includeTotal {
		go func() {
			var result countResult
			if len(filter) == 0 {
				result.total, result.err = coll.EstimatedDocumentCount(ctx)
				result.estimated = true
			} else {
				result.total, result.err = coll.CountDocuments(ctx, filter)
			}
			countCh <- result
		}()
	}

	findSkip := skip
	if useCursor {
		findSkip = 0
	}
	findOpts := options.Find().SetSkip(findSkip).SetLimit(limit + 1) // +1 detects hasMore
	if len(querySort) > 0 {
		findOpts.SetSort(querySort)
	}
	if len(proj) > 0 {
		findOpts.SetProjection(proj)
	}

	cursor, err := coll.Find(ctx, queryFilter, findOpts)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		a.dbErr(w, err)
		return
	}
	hasMore := int64(len(docs)) > limit
	if hasMore {
		docs = docs[:limit]
	}
	if reverse {
		for left, right := 0, len(docs)-1; left < right; left, right = left+1, right-1 {
			docs[left], docs[right] = docs[right], docs[left]
		}
	}

	var counted countResult
	var totalKnown bool
	if includeTotal {
		counted = <-countCh
		if counted.err != nil {
			a.dbErr(w, counted.err)
			return
		}
		totalKnown = true
	}

	durationMs := float64(time.Since(start).Microseconds()) / 1000
	raw, err := toExtJSON(docs)
	if err != nil {
		serverError(w, err)
		return
	}

	data := map[string]any{
		"documents":  raw,
		"skip":       skip,
		"limit":      limit,
		"hasMore":    hasMore,
		"durationMs": durationMs,
	}
	if totalKnown {
		data["total"] = counted.total
		data["totalEstimated"] = counted.estimated
	}
	if len(docs) > 0 {
		if next, err := documentIDCursor(docs[len(docs)-1]); err == nil {
			data["nextCursor"] = next
		}
		if prev, err := documentIDCursor(docs[0]); err == nil {
			data["prevCursor"] = prev
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

// parseOptionalExtJSONValue decodes an arbitrary Extended JSON value, returning
// nil when the cursor is absent or explicitly null.
func parseOptionalExtJSONValue(raw json.RawMessage) (any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var wrapper bson.D
	doc := append([]byte(`{"v":`), raw...)
	doc = append(doc, '}')
	if err := bson.UnmarshalExtJSON(doc, false, &wrapper); err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if len(wrapper) == 0 {
		return nil, nil
	}
	return wrapper[0].Value, nil
}

// idSortDirection returns the direction only when the sort is exactly _id, so a
// cursor can never silently reorder a compound sort.
func idSortDirection(sortDoc bson.D) int {
	if len(sortDoc) != 1 || sortDoc[0].Key != "_id" {
		return 0
	}
	switch value := sortDoc[0].Value.(type) {
	case int32:
		if value == 1 || value == -1 {
			return int(value)
		}
	case int64:
		if value == 1 || value == -1 {
			return int(value)
		}
	case float64:
		if value == 1 || value == -1 {
			return int(value)
		}
	}
	return 0
}

// applyIDRange combines the user filter with exclusive _id bounds. Several
// conditions are wrapped in $and so an existing top-level operator is kept.
func applyIDRange(filter bson.D, after, before any, direction int) bson.D {
	conditions := bson.A{}
	if after != nil {
		op := "$gt"
		if direction < 0 {
			op = "$lt"
		}
		conditions = append(conditions, bson.D{{Key: "_id", Value: bson.D{{Key: op, Value: after}}}})
	}
	if before != nil {
		op := "$lt"
		if direction < 0 {
			op = "$gt"
		}
		conditions = append(conditions, bson.D{{Key: "_id", Value: bson.D{{Key: op, Value: before}}}})
	}
	if len(conditions) == 0 {
		return filter
	}
	if len(filter) == 0 {
		if len(conditions) == 1 {
			return conditions[0].(bson.D)
		}
		return bson.D{{Key: "$and", Value: conditions}}
	}
	return bson.D{{Key: "$and", Value: append(bson.A{filter}, conditions...)}}
}

func documentIDCursor(doc bson.D) (json.RawMessage, error) {
	var id any
	found := false
	for _, element := range doc {
		if element.Key == "_id" {
			id = element.Value
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("document has no _id")
	}
	encoded, err := bson.MarshalExtJSON(bson.D{{Key: "_id", Value: id}}, false, false)
	if err != nil {
		return nil, err
	}
	var wrapper map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &wrapper); err != nil {
		return nil, err
	}
	return wrapper["_id"], nil
}
