package mcp

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/config"
	"mongoui/internal/sqlmongo"
)

// toolGroup identifies the read/write group a tool belongs to. Groups can be
// enabled or disabled independently (see config.MCPSettings).
type toolGroup string

const (
	readGroup  toolGroup = "read"
	writeGroup toolGroup = "write"
)

type tool struct {
	name        string
	description string
	inputSchema map[string]any
	group       toolGroup
	run         func(*Server, map[string]any) (string, error)
}

// toolGroup returns the group a tool belongs to. Tools default to the read
// group; only write tools set the field explicitly.
func (t tool) toolGroup() toolGroup {
	if t.group == writeGroup {
		return writeGroup
	}
	return readGroup
}

// callTool dispatches a tool by name, rejecting tools whose group is disabled.
func (s *Server) callTool(name string, args map[string]any) (string, error) {
	for _, t := range tools {
		if t.name != name {
			continue
		}
		group := t.toolGroup()
		if !s.groupEnabled(group) {
			return "", fmt.Errorf("tool %q is disabled: the MCP %s group is turned off", name, group)
		}
		return t.run(s, args)
	}
	return "", fmt.Errorf("unknown tool: %s", name)
}

// toolDefs returns the advertised tools, hiding groups that are disabled. Each
// definition carries its group (and the standard readOnlyHint annotation) so
// clients can reason about read vs write tools.
func (s *Server) toolDefs() []map[string]any {
	cfg := s.settings.GetMCP()
	defs := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		group := t.toolGroup()
		switch group {
		case readGroup:
			if !cfg.Read {
				continue
			}
		case writeGroup:
			if !cfg.Write {
				continue
			}
		}
		defs = append(defs, map[string]any{
			"name":        t.name,
			"description": t.description,
			"inputSchema": t.inputSchema,
			"group":       string(group),
			"annotations": map[string]any{"readOnlyHint": group == readGroup},
		})
	}
	return defs
}

// --- schema helpers ---------------------------------------------------------

func obj(props map[string]any, required ...string) map[string]any {
	m := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		m["required"] = required
	}
	return m
}

func strP(desc string) map[string]any  { return map[string]any{"type": "string", "description": desc} }
func numP(desc string) map[string]any  { return map[string]any{"type": "number", "description": desc} }
func boolP(desc string) map[string]any { return map[string]any{"type": "boolean", "description": desc} }
func objP(desc string) map[string]any  { return map[string]any{"type": "object", "description": desc} }
func arrP(desc string) map[string]any {
	return map[string]any{"type": "array", "description": desc, "items": map[string]any{"type": "object"}}
}

func connProp() map[string]any { return strP("Connection id from mongoui_list_connections") }

// --- tool registry ----------------------------------------------------------

var tools = []tool{
	{
		name:        "mongoui_list_connections",
		description: "List the saved MongoDB connection profiles (id, name, connected, readOnly). Call this first to get a connectionId.",
		inputSchema: obj(map[string]any{}),
		run:         toolListConnections,
	},
	{
		name:        "mongoui_connect",
		description: "Open a connection so data tools can run. Safe in read-only mode.",
		inputSchema: obj(map[string]any{"connectionId": connProp()}, "connectionId"),
		run:         toolConnect,
	},
	{
		name:        "mongoui_disconnect",
		description: "Close an open connection.",
		inputSchema: obj(map[string]any{"connectionId": connProp()}, "connectionId"),
		run:         toolDisconnect,
	},
	{
		name:        "mongoui_server_info",
		description: "Return MongoDB buildInfo for an open connection.",
		inputSchema: obj(map[string]any{"connectionId": connProp()}, "connectionId"),
		run:         toolServerInfo,
	},
	{
		name:        "mongoui_list_databases",
		description: "List databases on an open connection with their on-disk size.",
		inputSchema: obj(map[string]any{"connectionId": connProp()}, "connectionId"),
		run:         toolListDatabases,
	},
	{
		name:        "mongoui_list_collections",
		description: "List the collections of a database.",
		inputSchema: obj(map[string]any{"connectionId": connProp(), "database": strP("database name")}, "connectionId", "database"),
		run:         toolListCollections,
	},
	{
		name:        "mongoui_collection_stats",
		description: "Return collStats for a collection.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
		}, "connectionId", "database", "collection"),
		run: toolCollectionStats,
	},
	{
		name:        "mongoui_collection_schema",
		description: "Sample documents and summarise field coverage and BSON types.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
		}, "connectionId", "database", "collection"),
		run: toolCollectionSchema,
	},
	{
		name:        "mongoui_find",
		description: "Query documents. filter/sort/projection use MongoDB Extended JSON (e.g. {\"_id\":{\"$oid\":\"...\"}}).",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"filter": objP("query filter"), "sort": objP("sort spec"), "projection": objP("projection spec"),
			"skip": numP("documents to skip"), "limit": numP("max documents (default 50, max 1000)"),
		}, "connectionId", "database", "collection"),
		run: toolFind,
	},
	{
		name:        "mongoui_aggregate",
		description: "Run an aggregation pipeline (array of stage objects).",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"pipeline": arrP("array of pipeline stages"), "limit": numP("optional result cap"),
		}, "connectionId", "database", "collection", "pipeline"),
		run: toolAggregate,
	},
	{
		name:        "mongoui_sql",
		description: "Run a SQL SELECT (translated to MongoDB). FROM names the collection. Supports WHERE/IN/LIKE, ORDER BY, LIMIT, GROUP BY, HAVING, DISTINCT and COUNT/SUM/AVG/MIN/MAX.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"),
			"query": strP("SQL SELECT statement"), "limit": numP("optional result cap"),
		}, "connectionId", "database", "query"),
		run: toolSQL,
	},
	{
		name:        "mongoui_list_indexes",
		description: "List indexes on a collection.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
		}, "connectionId", "database", "collection"),
		run: toolListIndexes,
	},
	{
		name:        "mongoui_insert",
		description: "Insert one or more documents (Extended JSON array).",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"documents": arrP("documents to insert"),
		}, "connectionId", "database", "collection", "documents"),
		group: writeGroup,
		run:   toolInsert,
	},
	{
		name:        "mongoui_update",
		description: "Update documents. An update with $ operators updates in place, otherwise it replaces whole documents. many=true updates every match.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"filter": objP("which documents to update"), "update": objP("update document or replacement"),
			"many": boolP("update all matches (default first match)"), "upsert": boolP("insert when nothing matches"),
		}, "connectionId", "database", "collection", "filter", "update"),
		group: writeGroup,
		run:   toolUpdate,
	},
	{
		name:        "mongoui_delete",
		description: "Delete documents matching a filter. many=true deletes every match.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"filter": objP("which documents to delete"), "many": boolP("delete all matches"),
		}, "connectionId", "database", "collection", "filter"),
		group: writeGroup,
		run:   toolDelete,
	},
	{
		name:        "mongoui_create_collection",
		description: "Create a collection (optionally capped).",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"capped": boolP("create a capped collection"), "size": numP("capped size in bytes"), "max": numP("max documents"),
		}, "connectionId", "database", "collection"),
		group: writeGroup,
		run:   toolCreateCollection,
	},
	{
		name:        "mongoui_drop_collection",
		description: "Drop a collection.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
		}, "connectionId", "database", "collection"),
		group: writeGroup,
		run:   toolDropCollection,
	},
	{
		name:        "mongoui_drop_database",
		description: "Drop a database.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"),
		}, "connectionId", "database"),
		group: writeGroup,
		run:   toolDropDatabase,
	},
	{
		name:        "mongoui_create_index",
		description: "Create an index from a key spec, e.g. {\"email\":1} with optional options (unique, sparse, name, expireAfterSeconds).",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"keys": objP("index key spec"), "options": objP("index options"),
		}, "connectionId", "database", "collection", "keys"),
		group: writeGroup,
		run:   toolCreateIndex,
	},
	{
		name:        "mongoui_drop_index",
		description: "Drop an index by name.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"name": strP("index name"),
		}, "connectionId", "database", "collection", "name"),
		group: writeGroup,
		run:   toolDropIndex,
	},
	{
		name:        "mongoui_explain",
		description: "Return the execution plan (explain) for a find query or an aggregation pipeline. Use verbosity=executionStats to see examined/returned counts.",
		inputSchema: obj(map[string]any{
			"connectionId": connProp(), "database": strP("database name"), "collection": strP("collection name"),
			"type":       strP(`"find" (default) or "aggregate"`),
			"filter":     objP("query filter (find)"),
			"sort":       objP("sort spec (find)"),
			"projection": objP("projection spec (find)"),
			"pipeline":   arrP("aggregation pipeline (aggregate)"),
			"limit":      numP("limit"),
			"verbosity":  strP("queryPlanner (default), executionStats or allPlansExecution"),
		}, "connectionId", "database", "collection"),
		run: toolExplain,
	},
}

// --- argument helpers -------------------------------------------------------

func argStr(args map[string]any, key string) (string, error) {
	v, ok := args[key]
	if !ok || v == nil {
		return "", fmt.Errorf("missing required argument: %s", key)
	}
	if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
		return s, nil
	}
	return "", fmt.Errorf("%s must be a non-empty string", key)
}

func argInt(args map[string]any, key string, def int64) int64 {
	switch v := args[key].(type) {
	case float64:
		return int64(v)
	case int:
		return int64(v)
	case int64:
		return v
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n
		}
	}
	return def
}

func argBool(args map[string]any, key string, def bool) bool {
	if b, ok := args[key].(bool); ok {
		return b
	}
	return def
}

func argObject(args map[string]any, key string) (any, bool) {
	v, ok := args[key]
	if !ok || v == nil {
		return nil, false
	}
	return v, true
}

func argStrDefault(args map[string]any, key, def string) string {
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

// --- BSON / JSON helpers ----------------------------------------------------

func toBSON(raw any) (bson.D, error) {
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var d bson.D
	if err := bson.UnmarshalExtJSON(b, false, &d); err != nil {
		return nil, fmt.Errorf("invalid Extended JSON document: %w", err)
	}
	if d == nil {
		d = bson.D{}
	}
	return d, nil
}

func toBSONDocs(raw any) ([]bson.D, error) {
	arr, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("expected an array of documents")
	}
	docs := make([]bson.D, 0, len(arr))
	for i, item := range arr {
		d, err := toBSON(item)
		if err != nil {
			return nil, fmt.Errorf("documents[%d]: %w", i, err)
		}
		docs = append(docs, d)
	}
	return docs, nil
}

func toJSON(v any) (json.RawMessage, error) {
	if v == nil {
		return json.RawMessage("null"), nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		wrapped, err := bson.MarshalExtJSON(bson.D{{Key: "v", Value: v}}, false, false)
		if err != nil {
			return nil, err
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(wrapped, &m); err != nil {
			return nil, err
		}
		if raw, ok := m["v"]; ok {
			return raw, nil
		}
		return json.RawMessage("[]"), nil
	}
	return bson.MarshalExtJSON(v, false, false)
}

func jsonText(v any) (string, error) {
	raw, err := toJSON(v)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return string(raw), nil
	}
	return buf.String(), nil
}

func randomToken() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// --- server helpers ---------------------------------------------------------

func (s *Server) connection(id string) (config.Connection, error) {
	c, ok := s.store.Get(id)
	if !ok {
		return config.Connection{}, fmt.Errorf("unknown connection %q (use mongoui_list_connections)", id)
	}
	return c, nil
}

func (s *Server) writeConnection(id string) (config.Connection, error) {
	c, err := s.connection(id)
	if err != nil {
		return c, err
	}
	if c.ReadOnly {
		return c, fmt.Errorf("connection %q is marked read-only; writes are disabled", c.Name)
	}
	return c, nil
}

func (s *Server) client(id string) (*mongo.Client, error) {
	return s.mgr.Get(id)
}

func opCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 60*time.Second)
}

func clampLimit(n, def, max int64) int64 {
	if n <= 0 {
		n = def
	}
	if n > max {
		n = max
	}
	return n
}

// --- tool implementations ---------------------------------------------------

func toolListConnections(s *Server, _ map[string]any) (string, error) {
	conns := s.store.List()
	out := make([]map[string]any, 0, len(conns))
	for _, c := range conns {
		out = append(out, map[string]any{
			"id":        c.ID,
			"name":      c.Name,
			"color":     c.Color,
			"readOnly":  c.ReadOnly,
			"connected": s.mgr.IsConnected(c.ID),
			"ssh":       c.SSH != nil && c.SSH.Enabled,
		})
	}
	return jsonText(out)
}

func toolConnect(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	c, err := s.connection(id)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := s.mgr.Connect(ctx, c.ID, c.URI, c.SSH); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"connected": true, "id": c.ID, "name": c.Name})
}

func toolDisconnect(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.connection(id); err != nil {
		return "", err
	}
	s.mgr.Disconnect(id)
	return jsonText(map[string]any{"connected": false, "id": id})
}

func toolServerInfo(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	var res bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo"}}).Decode(&res); err != nil {
		return "", err
	}
	return jsonText(res)
}

func toolListDatabases(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()

	var res struct {
		Databases []struct {
			Name       string `bson:"name"`
			SizeOnDisk int64  `bson:"sizeOnDisk"`
			Empty      bool   `bson:"empty"`
		} `bson:"databases"`
		TotalSize int64 `bson:"totalSize"`
	}
	cmd := bson.D{{Key: "listDatabases"}, {Key: "nameOnly", Value: false}}
	if err := client.Database("admin").RunCommand(ctx, cmd).Decode(&res); err != nil {
		return "", err
	}
	out := make([]map[string]any, 0, len(res.Databases))
	for _, d := range res.Databases {
		out = append(out, map[string]any{"name": d.Name, "sizeOnDisk": d.SizeOnDisk, "empty": d.Empty})
	}
	return jsonText(map[string]any{"databases": out, "totalSize": res.TotalSize})
}

func toolListCollections(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	db, err := argStr(args, "database")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	names, err := client.Database(db).ListCollectionNames(ctx, bson.D{})
	if err != nil {
		return "", err
	}
	sort.Strings(names)
	return jsonText(map[string]any{"collections": names, "count": len(names)})
}

func toolCollectionStats(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	var res bson.M
	cmd := bson.D{{Key: "collStats", Value: coll.Name()}}
	if err := coll.Database().RunCommand(ctx, cmd).Decode(&res); err != nil {
		return "", err
	}
	return jsonText(res)
}

func toolCollectionSchema(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()

	cursor, err := coll.Find(ctx, bson.D{}, options.Find().SetLimit(200))
	if err != nil {
		return "", err
	}
	defer cursor.Close(ctx)
	var docs []bson.Raw
	if err := cursor.All(ctx, &docs); err != nil {
		return "", err
	}

	type fieldStat struct {
		count int
		types map[string]int
	}
	stats := map[string]*fieldStat{}
	for _, doc := range docs {
		elems, err := doc.Elements()
		if err != nil {
			continue
		}
		for _, e := range elems {
			st := stats[e.Key()]
			if st == nil {
				st = &fieldStat{types: map[string]int{}}
				stats[e.Key()] = st
			}
			st.count++
			st.types[e.Value().Type.String()]++
		}
	}
	fields := make([]map[string]any, 0, len(stats))
	for name, st := range stats {
		fields = append(fields, map[string]any{"name": name, "count": st.count, "types": st.types})
	}
	sort.Slice(fields, func(i, j int) bool {
		ci, cj := fields[i]["count"].(int), fields[j]["count"].(int)
		if ci != cj {
			return ci > cj
		}
		return fields[i]["name"].(string) < fields[j]["name"].(string)
	})
	return jsonText(map[string]any{"sampled": len(docs), "fields": fields})
}

func toolFind(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}
	filter := bson.D{}
	if raw, ok := argObject(args, "filter"); ok {
		if filter, err = toBSON(raw); err != nil {
			return "", err
		}
	}
	sortDoc := bson.D{}
	if raw, ok := argObject(args, "sort"); ok {
		if sortDoc, err = toBSON(raw); err != nil {
			return "", err
		}
	}
	projection := bson.D{}
	if raw, ok := argObject(args, "projection"); ok {
		if projection, err = toBSON(raw); err != nil {
			return "", err
		}
	}
	skip := argInt(args, "skip", 0)
	if skip < 0 {
		skip = 0
	}
	limit := clampLimit(argInt(args, "limit", 0), 50, 1000)

	ctx, cancel := opCtx()
	defer cancel()

	total, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return "", err
	}
	opts := options.Find().SetSkip(skip).SetLimit(limit)
	if len(sortDoc) > 0 {
		opts.SetSort(sortDoc)
	}
	if len(projection) > 0 {
		opts.SetProjection(projection)
	}
	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		return "", err
	}
	defer cursor.Close(ctx)
	var docs []bson.D
	if err := cursor.All(ctx, &docs); err != nil {
		return "", err
	}
	return jsonText(map[string]any{
		"documents": docs, "count": len(docs), "total": total, "skip": skip, "limit": limit,
	})
}

func toolAggregate(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}
	rawStages, ok := args["pipeline"].([]any)
	if !ok || len(rawStages) == 0 {
		return "", fmt.Errorf("pipeline must be a non-empty array")
	}
	pipeline := make([]bson.D, 0, len(rawStages)+1)
	for i, raw := range rawStages {
		stage, err := toBSON(raw)
		if err != nil {
			return "", fmt.Errorf("pipeline[%d]: %w", i, err)
		}
		if !s.groupEnabled(writeGroup) {
			for _, e := range stage {
				if e.Key == "$out" || e.Key == "$merge" {
					return "", fmt.Errorf("$out and $merge are disabled while the MCP write group is off")
				}
			}
		}
		pipeline = append(pipeline, stage)
	}
	limit := clampLimit(argInt(args, "limit", 0), 1000, 1000)
	pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})

	ctx, cancel := opCtx()
	defer cancel()
	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		return "", err
	}
	defer cursor.Close(ctx)
	var docs []bson.D
	if err := cursor.All(ctx, &docs); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"documents": docs, "count": len(docs)})
}

func toolSQL(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	db, err := argStr(args, "database")
	if err != nil {
		return "", err
	}
	query, err := argStr(args, "query")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	parsed, err := sqlmongo.Translate(query)
	if err != nil {
		return "", err
	}
	limit := parsed.Limit
	if override := argInt(args, "limit", 0); override > 0 {
		limit = override
	}
	limit = clampLimit(limit, 50, 1000)
	skip := parsed.Skip
	if skip < 0 {
		skip = 0
	}

	ctx, cancel := opCtx()
	defer cancel()
	coll := client.Database(db).Collection(parsed.Collection)
	docs := []bson.D{}
	var total int64
	if parsed.Aggregate {
		pipeline := make([]bson.D, 0, len(parsed.Pipeline)+2)
		pipeline = append(pipeline, parsed.Pipeline...)
		if skip > 0 {
			pipeline = append(pipeline, bson.D{{Key: "$skip", Value: skip}})
		}
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
		cursor, err := coll.Aggregate(ctx, pipeline)
		if err != nil {
			return "", err
		}
		defer cursor.Close(ctx)
		if err := cursor.All(ctx, &docs); err != nil {
			return "", err
		}
		total = int64(len(docs))
	} else {
		total, err = coll.CountDocuments(ctx, parsed.Filter)
		if err != nil {
			return "", err
		}
		opts := options.Find().SetSkip(skip).SetLimit(limit)
		if len(parsed.Sort) > 0 {
			opts.SetSort(parsed.Sort)
		}
		if len(parsed.Projection) > 0 {
			opts.SetProjection(parsed.Projection)
		}
		cursor, err := coll.Find(ctx, parsed.Filter, opts)
		if err != nil {
			return "", err
		}
		defer cursor.Close(ctx)
		if err := cursor.All(ctx, &docs); err != nil {
			return "", err
		}
	}
	return jsonText(map[string]any{
		"documents": docs, "count": len(docs), "total": total, "columns": parsed.Columns,
	})
}

func toolListIndexes(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	cursor, err := coll.Indexes().List(ctx)
	if err != nil {
		return "", err
	}
	var indexes []bson.M
	if err := cursor.All(ctx, &indexes); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"indexes": indexes, "count": len(indexes)})
}

func toolInsert(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	docs, err := toBSONDocs(args["documents"])
	if err != nil {
		return "", err
	}
	if len(docs) == 0 {
		return "", fmt.Errorf("documents must be a non-empty array")
	}
	ctx, cancel := opCtx()
	defer cancel()

	if len(docs) == 1 {
		res, err := coll.InsertOne(ctx, docs[0])
		if err != nil {
			return "", err
		}
		return jsonText(map[string]any{"insertedCount": 1, "insertedId": res.InsertedID})
	}
	res, err := coll.InsertMany(ctx, docsToAny(docs), options.InsertMany().SetOrdered(true))
	if err != nil {
		return "", err
	}
	return jsonText(map[string]any{"insertedCount": len(res.InsertedIDs), "insertedIds": res.InsertedIDs})
}

func toolUpdate(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	rawFilter, ok := argObject(args, "filter")
	if !ok {
		return "", fmt.Errorf("missing required argument: filter")
	}
	filter, err := toBSON(rawFilter)
	if err != nil {
		return "", err
	}
	rawUpdate, ok := argObject(args, "update")
	if !ok {
		return "", fmt.Errorf("missing required argument: update")
	}
	update, err := toBSON(rawUpdate)
	if err != nil {
		return "", err
	}
	many := argBool(args, "many", false)
	upsert := argBool(args, "upsert", false)

	ctx, cancel := opCtx()
	defer cancel()

	if !hasUpdateOperator(update) {
		res, err := coll.ReplaceOne(ctx, filter, update, options.Replace().SetUpsert(upsert))
		if err != nil {
			return "", err
		}
		return jsonText(map[string]any{
			"matchedCount": res.MatchedCount, "modifiedCount": res.ModifiedCount, "upsertedCount": res.UpsertedCount,
		})
	}
	opts := options.Update().SetUpsert(upsert)
	var res *mongo.UpdateResult
	if many {
		res, err = coll.UpdateMany(ctx, filter, update, opts)
	} else {
		res, err = coll.UpdateOne(ctx, filter, update, opts)
	}
	if err != nil {
		return "", err
	}
	return jsonText(map[string]any{
		"matchedCount": res.MatchedCount, "modifiedCount": res.ModifiedCount, "upsertedCount": res.UpsertedCount,
	})
}

func toolDelete(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	rawFilter, ok := argObject(args, "filter")
	if !ok {
		return "", fmt.Errorf("missing required argument: filter")
	}
	filter, err := toBSON(rawFilter)
	if err != nil {
		return "", err
	}
	many := argBool(args, "many", false)

	ctx, cancel := opCtx()
	defer cancel()
	var res *mongo.DeleteResult
	if many {
		res, err = coll.DeleteMany(ctx, filter)
	} else {
		res, err = coll.DeleteOne(ctx, filter)
	}
	if err != nil {
		return "", err
	}
	return jsonText(map[string]any{"deletedCount": res.DeletedCount})
}

func toolCreateCollection(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	db, err := argStr(args, "database")
	if err != nil {
		return "", err
	}
	name, err := argStr(args, "collection")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	opts := options.CreateCollection()
	if argBool(args, "capped", false) {
		opts.SetCapped(true)
	}
	if size := argInt(args, "size", 0); size > 0 {
		opts.SetSizeInBytes(size)
	}
	if max := argInt(args, "max", 0); max > 0 {
		opts.SetMaxDocuments(max)
	}
	ctx, cancel := opCtx()
	defer cancel()
	if err := client.Database(db).CreateCollection(ctx, name, opts); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"created": name, "database": db})
}

func toolDropCollection(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	if err := coll.Drop(ctx); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"dropped": coll.Name()})
}

func toolDropDatabase(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	db, err := argStr(args, "database")
	if err != nil {
		return "", err
	}
	client, err := s.client(id)
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	if err := client.Database(db).Drop(ctx); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"dropped": db})
}

func toolCreateIndex(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	rawKeys, ok := argObject(args, "keys")
	if !ok {
		return "", fmt.Errorf("missing required argument: keys")
	}
	keys, err := toBSON(rawKeys)
	if err != nil {
		return "", err
	}
	indexDoc := bson.D{{Key: "key", Value: keys}}
	if rawOpts, ok := argObject(args, "options"); ok {
		opts, err := toBSON(rawOpts)
		if err != nil {
			return "", err
		}
		indexDoc = append(indexDoc, opts...)
	}
	cmd := bson.D{
		{Key: "createIndexes", Value: coll.Name()},
		{Key: "indexes", Value: bson.A{indexDoc}},
	}
	ctx, cancel := opCtx()
	defer cancel()
	var res bson.M
	if err := coll.Database().RunCommand(ctx, cmd).Decode(&res); err != nil {
		return "", err
	}
	name := "unknown"
	for _, e := range indexDoc {
		if e.Key == "name" {
			if s, ok := e.Value.(string); ok {
				name = s
			}
		}
	}
	return jsonText(map[string]any{"created": true, "name": name, "result": res})
}

func toolDropIndex(s *Server, args map[string]any) (string, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return "", err
	}
	if _, err := s.writeConnection(id); err != nil {
		return "", err
	}
	coll, err := targetFrom(s, id, args)
	if err != nil {
		return "", err
	}
	name, err := argStr(args, "name")
	if err != nil {
		return "", err
	}
	ctx, cancel := opCtx()
	defer cancel()
	if _, err := coll.Indexes().DropOne(ctx, name); err != nil {
		return "", err
	}
	return jsonText(map[string]any{"dropped": name})
}

// --- shared helpers ---------------------------------------------------------

func target(s *Server, args map[string]any) (*mongo.Collection, error) {
	id, err := argStr(args, "connectionId")
	if err != nil {
		return nil, err
	}
	return targetFrom(s, id, args)
}

func targetFrom(s *Server, id string, args map[string]any) (*mongo.Collection, error) {
	db, err := argStr(args, "database")
	if err != nil {
		return nil, err
	}
	coll, err := argStr(args, "collection")
	if err != nil {
		return nil, err
	}
	client, err := s.client(id)
	if err != nil {
		return nil, err
	}
	return client.Database(db).Collection(coll), nil
}

func docsToAny(docs []bson.D) []any {
	out := make([]any, len(docs))
	for i, d := range docs {
		out[i] = d
	}
	return out
}

func hasUpdateOperator(update bson.D) bool {
	for _, e := range update {
		if strings.HasPrefix(e.Key, "$") {
			return true
		}
	}
	return false
}

func toolExplain(s *Server, args map[string]any) (string, error) {
	coll, err := target(s, args)
	if err != nil {
		return "", err
	}

	verbosity := "queryPlanner"
	if v := argStrDefault(args, "verbosity", ""); v != "" {
		switch v {
		case "queryPlanner", "executionStats", "allPlansExecution":
			verbosity = v
		default:
			return "", fmt.Errorf("verbosity must be queryPlanner, executionStats or allPlansExecution")
		}
	}

	queryType := "find"
	if v := argStrDefault(args, "type", ""); v != "" {
		queryType = strings.ToLower(v)
	}

	var plan bson.D
	switch queryType {
	case "find":
		filter := bson.D{}
		if raw, ok := argObject(args, "filter"); ok {
			if filter, err = toBSON(raw); err != nil {
				return "", err
			}
		}
		sortDoc := bson.D{}
		if raw, ok := argObject(args, "sort"); ok {
			if sortDoc, err = toBSON(raw); err != nil {
				return "", err
			}
		}
		projection := bson.D{}
		if raw, ok := argObject(args, "projection"); ok {
			if projection, err = toBSON(raw); err != nil {
				return "", err
			}
		}
		plan = bson.D{{Key: "find", Value: coll.Name()}}
		if len(filter) > 0 {
			plan = append(plan, bson.E{Key: "filter", Value: filter})
		}
		if len(sortDoc) > 0 {
			plan = append(plan, bson.E{Key: "sort", Value: sortDoc})
		}
		if len(projection) > 0 {
			plan = append(plan, bson.E{Key: "projection", Value: projection})
		}
		if limit := argInt(args, "limit", 0); limit > 0 {
			plan = append(plan, bson.E{Key: "limit", Value: limit})
		}
	case "aggregate":
		rawStages, ok := args["pipeline"].([]any)
		if !ok || len(rawStages) == 0 {
			return "", fmt.Errorf("pipeline must be a non-empty array")
		}
		stages := make([]bson.D, 0, len(rawStages))
		for i, raw := range rawStages {
			stage, err := toBSON(raw)
			if err != nil {
				return "", fmt.Errorf("pipeline[%d]: %w", i, err)
			}
			stages = append(stages, stage)
		}
		plan = bson.D{
			{Key: "aggregate", Value: coll.Name()},
			{Key: "pipeline", Value: stages},
			{Key: "cursor", Value: bson.D{}},
		}
	default:
		return "", fmt.Errorf(`type must be "find" or "aggregate"`)
	}

	ctx, cancel := opCtx()
	defer cancel()

	var res bson.D
	cmd := bson.D{{Key: "explain", Value: plan}, {Key: "verbosity", Value: verbosity}}
	if err := coll.Database().RunCommand(ctx, cmd).Decode(&res); err != nil {
		return "", err
	}
	return jsonText(res)
}
