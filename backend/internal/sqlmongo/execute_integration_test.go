package sqlmongo

import (
	"context"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestExecuteCrossDBIntegration(t *testing.T) {
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Disconnect(context.Background())

	left := client.Database("zz_cross_a").Collection("users")
	right := client.Database("zz_cross_b").Collection("orders")
	_ = left.Drop(ctx)
	_ = right.Drop(ctx)
	defer left.Drop(context.Background())
	defer right.Drop(context.Background())
	if _, err := left.InsertMany(ctx, []any{
		bson.D{{Key: "_id", Value: int32(1)}, {Key: "name", Value: "Ada"}},
		bson.D{{Key: "_id", Value: int32(2)}, {Key: "name", Value: "Linus"}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := right.InsertMany(ctx, []any{
		bson.D{{Key: "userId", Value: int32(1)}, {Key: "total", Value: int32(10)}},
		bson.D{{Key: "userId", Value: int32(1)}, {Key: "total", Value: int32(20)}},
		bson.D{{Key: "userId", Value: int32(2)}, {Key: "total", Value: int32(5)}},
	}); err != nil {
		t.Fatal(err)
	}

	query, err := Translate("SELECT u.name, o.total FROM zz_cross_a.users u JOIN zz_cross_b.orders o ON u._id = o.userId WHERE o.total > 10 ORDER BY o.total DESC LIMIT 10")
	if err != nil {
		t.Fatal(err)
	}
	docs, total, err := ExecuteCrossDB(ctx, client, "", query, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(docs) != 1 {
		t.Fatalf("total/docs = %d/%d: %#v", total, len(docs), docs)
	}
	if got := pathValue(docs[0], "name"); got != "Ada" {
		t.Fatalf("name = %v", got)
	}
	if got := pathValue(docs[0], "o_total"); got != int32(20) {
		t.Fatalf("o_total = %v", got)
	}
}
