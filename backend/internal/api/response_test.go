package api

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestParseExtJSOND(t *testing.T) {
	doc, err := parseExtJSOND(`{"a": 1, "id": {"$oid": "507f1f77bcf86cd799439011"}}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(doc) != 2 {
		t.Fatalf("expected 2 fields, got %d", len(doc))
	}
	if doc[0].Key != "a" || doc[1].Key != "id" {
		t.Fatalf("field order not preserved: %+v", doc)
	}
}

func TestParseExtJSONDEmpty(t *testing.T) {
	for _, input := range []string{"", "   ", "null", "\n"} {
		doc, err := parseExtJSOND(input)
		if err != nil {
			t.Fatalf("input %q: unexpected error: %v", input, err)
		}
		if len(doc) != 0 {
			t.Fatalf("input %q: expected empty document, got %+v", input, doc)
		}
	}
}

func TestParseExtJSONDInvalid(t *testing.T) {
	if _, err := parseExtJSOND("{not json}"); err == nil {
		t.Fatal("expected an error for invalid JSON")
	}
}

func TestToExtJSONDocument(t *testing.T) {
	raw, err := toExtJSON(bson.D{{Key: "name", Value: "abc"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := string(raw); got != `{"name":"abc"}` {
		t.Fatalf("unexpected output: %s", got)
	}
}

func TestToExtJSONArray(t *testing.T) {
	raw, err := toExtJSON([]bson.D{
		{{Key: "a", Value: int32(1)}},
		{{Key: "b", Value: true}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := string(raw); got != `[{"a":1},{"b":true}]` {
		t.Fatalf("unexpected output: %s", got)
	}
}

func TestToExtJSONNilSlice(t *testing.T) {
	raw, err := toExtJSON([]bson.D{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
		t.Fatalf("expected an array, got %s", raw)
	}
}

func TestHasUpdateOperator(t *testing.T) {
	if !hasUpdateOperator(bson.D{{Key: "$set", Value: bson.D{}}}) {
		t.Fatal("expected $set to be detected as an update operator")
	}
	if hasUpdateOperator(bson.D{{Key: "name", Value: "x"}}) {
		t.Fatal("plain replacement document should not be an update operator")
	}
}
