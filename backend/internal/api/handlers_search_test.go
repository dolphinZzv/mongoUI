package api

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestSearchMatchExpr(t *testing.T) {
	for _, mode := range []string{"value", "field"} {
		expr := searchMatchExpr(mode, "abc")
		if _, ok := expr["$expr"].(bson.M); !ok {
			t.Fatalf("%s: missing $expr: %#v", mode, expr)
		}
		if _, err := bson.Marshal(expr); err != nil {
			t.Fatalf("%s: marshal failed: %v", mode, err)
		}
	}

	// The field mode matches on the key; the value mode stringifies the value.
	filter := searchMatchExpr("field", "x")["$expr"].(bson.M)["$gt"].(bson.A)[0].(bson.M)["$size"].(bson.M)["$filter"].(bson.M)["cond"].(bson.M)["$regexMatch"].(bson.M)["input"]
	if filter != "$$kv.k" {
		t.Fatalf("field mode should match on key, got %#v", filter)
	}
}
