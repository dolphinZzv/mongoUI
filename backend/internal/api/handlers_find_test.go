package api

import (
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestIDSortDirection(t *testing.T) {
	tests := []struct {
		name string
		sort bson.D
		want int
	}{
		{"ascending", bson.D{{Key: "_id", Value: int32(1)}}, 1},
		{"descending", bson.D{{Key: "_id", Value: int32(-1)}}, -1},
		{"compound", bson.D{{Key: "_id", Value: int32(1)}, {Key: "name", Value: int32(1)}}, 0},
		{"other field", bson.D{{Key: "name", Value: int32(1)}}, 0},
		{"unsupported direction", bson.D{{Key: "_id", Value: int32(2)}}, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := idSortDirection(test.sort); got != test.want {
				t.Fatalf("idSortDirection() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestApplyIDRange(t *testing.T) {
	base := bson.D{{Key: "name", Value: "Alice"}}

	tests := []struct {
		name      string
		filter    bson.D
		after     any
		before    any
		direction int
		want      bson.D
	}{
		{
			name:      "no bounds",
			filter:    base,
			direction: 1,
			want:      base,
		},
		{
			name:      "after ascending",
			filter:    bson.D{},
			after:     10,
			direction: 1,
			want:      bson.D{{Key: "_id", Value: bson.D{{Key: "$gt", Value: 10}}}},
		},
		{
			name:      "after descending",
			filter:    bson.D{},
			after:     10,
			direction: -1,
			want:      bson.D{{Key: "_id", Value: bson.D{{Key: "$lt", Value: 10}}}},
		},
		{
			name:      "before ascending",
			filter:    bson.D{},
			before:    10,
			direction: 1,
			want:      bson.D{{Key: "_id", Value: bson.D{{Key: "$lt", Value: 10}}}},
		},
		{
			name:      "before descending",
			filter:    bson.D{},
			before:    10,
			direction: -1,
			want:      bson.D{{Key: "_id", Value: bson.D{{Key: "$gt", Value: 10}}}},
		},
		{
			name:      "range with user filter",
			filter:    base,
			after:     10,
			before:    20,
			direction: 1,
			want: bson.D{{Key: "$and", Value: bson.A{
				base,
				bson.D{{Key: "_id", Value: bson.D{{Key: "$gt", Value: 10}}}},
				bson.D{{Key: "_id", Value: bson.D{{Key: "$lt", Value: 20}}}},
			}}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := applyIDRange(test.filter, test.after, test.before, test.direction)
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("applyIDRange() = %#v, want %#v", got, test.want)
			}
		})
	}
}
