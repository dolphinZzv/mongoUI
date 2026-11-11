package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// watchCollection streams change events as Server-Sent Events. The optional
// ?filter= query is a MongoDB match document (Extended JSON) applied to the
// change stream pipeline.
func (a *API) watchCollection(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	filter, err := parseExtJSOND(r.URL.Query().Get("filter"))
	if err != nil {
		badRequest(w, err)
		return
	}
	pipeline := mongo.Pipeline{}
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		serverError(w, fmt.Errorf("streaming is not supported by this server"))
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	stream, err := coll.Watch(ctx, pipeline)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer stream.Close(context.Background())

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	events := make(chan bson.M)
	errs := make(chan error, 1)
	go func() {
		defer close(events)
		for stream.Next(ctx) {
			var event bson.M
			if err := stream.Decode(&event); err != nil {
				continue
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
		if err := stream.Err(); err != nil {
			select {
			case errs <- err:
			default:
			}
		}
	}()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case err := <-errs:
			if err != nil {
				payload, _ := json.Marshal(map[string]string{"error": err.Error()})
				_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload)
				flusher.Flush()
			}
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			raw, err := toExtJSON(event)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
			flusher.Flush()
		}
	}
}
