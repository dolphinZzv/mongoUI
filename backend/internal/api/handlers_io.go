package api

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	defaultExportLimit = 10000
	maxExportLimit     = 100000
	importBatchSize    = 1000
)

type exportRequest struct {
	Format     string          `json:"format"`
	Filter     json.RawMessage `json:"filter"`
	Sort       json.RawMessage `json:"sort"`
	Projection json.RawMessage `json:"projection"`
	Limit      int64           `json:"limit"`
}

// exportDocuments streams a collection (or a filtered subset) back to the
// client as JSON (Extended JSON) or CSV. The payload is returned inside the
// usual JSON envelope so the SPA can turn it into a download.
func (a *API) exportDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req exportRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		badRequest(w, errors.New(`format must be "json" or "csv"`))
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
		limit = defaultExportLimit
	}
	if limit > maxExportLimit {
		limit = maxExportLimit
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	findOpts := options.Find().SetLimit(limit)
	if len(sortDoc) > 0 {
		findOpts.SetSort(sortDoc)
	}
	if len(proj) > 0 {
		findOpts.SetProjection(proj)
	}

	cursor, err := coll.Find(ctx, filter, findOpts)
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

	name := chi.URLParam(r, "db") + "." + coll.Name()
	var content, contentType, ext string
	switch format {
	case "csv":
		content, err = documentsToCSV(docs)
		if err != nil {
			serverError(w, err)
			return
		}
		contentType = "text/csv; charset=utf-8"
		ext = "csv"
	default:
		raw, err := toExtJSON(docs)
		if err != nil {
			serverError(w, err)
			return
		}
		var buf bytes.Buffer
		if err := json.Indent(&buf, raw, "", "  "); err != nil {
			serverError(w, err)
			return
		}
		content = buf.String()
		contentType = "application/json; charset=utf-8"
		ext = "json"
	}

	ok(w, map[string]any{
		"filename":    name + "." + ext,
		"contentType": contentType,
		"content":     content,
		"count":       len(docs),
	})
}

type importRequest struct {
	Format  string `json:"format"`
	Content string `json:"content"`
	Drop    bool   `json:"drop"`
}

// importDocuments inserts documents parsed from JSON (array or NDJSON, Extended
// JSON) or CSV into a collection. When Drop is set the collection is recreated
// first, which doubles as a "restore from backup" flow.
func (a *API) importDocuments(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req importRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = "json"
	}
	docs, err := parseImportContent(format, req.Content)
	if err != nil {
		badRequest(w, err)
		return
	}
	if len(docs) == 0 {
		badRequest(w, errors.New("no documents found in the input"))
		return
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	if req.Drop {
		if err := coll.Drop(ctx); err != nil && !isNamespaceNotFound(err) {
			a.dbErr(w, err)
			return
		}
	}

	inserted := 0
	for start := 0; start < len(docs); start += importBatchSize {
		end := start + importBatchSize
		if end > len(docs) {
			end = len(docs)
		}
		batch := make([]any, 0, end-start)
		for _, d := range docs[start:end] {
			batch = append(batch, d)
		}
		if _, err := coll.InsertMany(ctx, batch); err != nil {
			a.dbErr(w, err)
			return
		}
		inserted += end - start
	}

	ok(w, map[string]any{"insertedCount": inserted})
}

// parseImportContent parses the request payload into ordered documents.
func parseImportContent(format, content string) ([]bson.D, error) {
	switch format {
	case "json":
		return parseJSONImport(content)
	case "csv":
		return parseCSVImport(content)
	default:
		return nil, errors.New(`format must be "json" or "csv"`)
	}
}

// parseJSONImport accepts either a single Extended JSON array or newline
// delimited Extended JSON objects (NDJSON).
func parseJSONImport(content string) ([]bson.D, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var docs []bson.D
		if err := bson.UnmarshalExtJSON([]byte(trimmed), false, &docs); err != nil {
			return nil, fmt.Errorf("invalid Extended JSON array: %w", err)
		}
		return docs, nil
	}
	var docs []bson.D
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var d bson.D
		if err := bson.UnmarshalExtJSON([]byte(line), false, &d); err != nil {
			return nil, fmt.Errorf("invalid Extended JSON line %q: %w", line, err)
		}
		if len(d) > 0 {
			docs = append(docs, d)
		}
	}
	return docs, nil
}

// parseCSVImport treats the first row as the header and converts each cell to
// the most specific BSON type it can infer.
func parseCSVImport(content string) ([]bson.D, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil
	}
	header := records[0]
	docs := make([]bson.D, 0, len(records)-1)
	for _, row := range records[1:] {
		doc := bson.D{}
		for i, name := range header {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			doc = append(doc, bson.E{Key: name, Value: parseCSVCell(cell)})
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

// parseCSVCell coerces a CSV cell into a BSON-friendly value. Numbers, booleans,
// null and embedded JSON/Extended JSON objects are recognised; everything else
// stays a string.
func parseCSVCell(cell string) any {
	s := strings.TrimSpace(cell)
	if s == "" || s == "null" {
		return nil
	}
	switch strings.ToLower(s) {
	case "true":
		return true
	case "false":
		return false
	}
	if i, err := strconv.ParseInt(s, 10, 64); err == nil {
		return i
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") ||
		strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]") {
		var v any
		if err := bson.UnmarshalExtJSON([]byte(s), false, &v); err == nil {
			return v
		}
	}
	return cell
}

// documentsToCSV flattens the top level fields of the documents into CSV.
func documentsToCSV(docs []bson.D) (string, error) {
	headers := csvHeaders(docs)
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write(headers); err != nil {
		return "", err
	}
	for _, doc := range docs {
		m := doc.Map()
		row := make([]string, len(headers))
		for i, h := range headers {
			row[i] = csvCell(m[h])
		}
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func csvHeaders(docs []bson.D) []string {
	seen := map[string]bool{}
	headers := []string{}
	for _, doc := range docs {
		for _, e := range doc {
			if !seen[e.Key] {
				seen[e.Key] = true
				headers = append(headers, e.Key)
			}
		}
	}
	// Keep _id as the first column when present.
	for i, h := range headers {
		if h == "_id" && i != 0 {
			rest := make([]string, 0, len(headers))
			rest = append(rest, "_id")
			rest = append(rest, headers[:i]...)
			rest = append(rest, headers[i+1:]...)
			headers = rest
			break
		}
	}
	return headers
}

// csvCell renders a BSON value as a single CSV cell. Common scalar types are
// rendered naturally (ObjectId hex, ISO dates, ...); nested values become
// compact Extended JSON.
func csvCell(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case int:
		return strconv.Itoa(t)
	case int32:
		return strconv.FormatInt(int64(t), 10)
	case int64:
		return strconv.FormatInt(t, 10)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case primitive.ObjectID:
		return t.Hex()
	case primitive.DateTime:
		return t.Time().UTC().Format(time.RFC3339Nano)
	case primitive.Decimal128:
		return t.String()
	case primitive.Binary:
		return base64.StdEncoding.EncodeToString(t.Data)
	case primitive.Timestamp:
		return strconv.FormatUint(uint64(t.T), 10)
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	default:
		if raw, err := toExtJSON(v); err == nil {
			return string(raw)
		}
		return fmt.Sprint(v)
	}
}
