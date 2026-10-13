package api

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestTransformDocument(t *testing.T) {
	doc := bson.D{{Key: "a", Value: 1}, {Key: "b", Value: 2}, {Key: "c", Value: 3}}

	out := transformDocument(doc, map[string]string{"a": "x"}, map[string]bool{"c": true})
	if len(out) != 2 {
		t.Fatalf("expected 2 fields, got %d", len(out))
	}
	if out[0].Key != "x" || out[1].Key != "b" {
		t.Fatalf("unexpected fields: %#v", out)
	}

	if same := transformDocument(doc, nil, nil); len(same) != 3 {
		t.Fatalf("expected a no-op, got %d fields", len(same))
	}
}
