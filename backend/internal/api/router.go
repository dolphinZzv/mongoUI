package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.mongodb.org/mongo-driver/mongo"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

// API holds shared dependencies for all HTTP handlers.
type API struct {
	store      *config.Store
	mgr        *mongoclient.Manager
	uiEmbedded bool
	version    string
	mcpHandler http.Handler
}

// New builds an API instance. mcpHandler, when non-nil, is mounted at /mcp.
func New(store *config.Store, mgr *mongoclient.Manager, uiEmbedded bool, version string, mcpHandler http.Handler) *API {
	return &API{store: store, mgr: mgr, uiEmbedded: uiEmbedded, version: version, mcpHandler: mcpHandler}
}

// Router returns the fully configured HTTP handler.
func (a *API) Router(webHandler http.Handler) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"Link", "Mcp-Session-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			ok(w, map[string]any{
				"status":     "ok",
				"version":    a.version,
				"uiEmbedded": a.uiEmbedded,
			})
		})

		r.Route("/connections", func(r chi.Router) {
			r.Get("/", a.listConnections)
			r.Post("/", a.createConnection)
			r.Post("/test", a.testConnection)

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", a.getConnection)
				r.Put("/", a.updateConnection)
				r.Delete("/", a.deleteConnection)

				r.Post("/connect", a.connect)
				r.Post("/disconnect", a.disconnect)
				r.Get("/server", a.serverInfo)

				r.Get("/databases", a.listDatabases)
				r.Post("/databases", a.createDatabase)

				r.Route("/databases/{db}", func(r chi.Router) {
					r.Delete("/", a.dropDatabase)
					r.Get("/stats", a.databaseStats)
					r.Post("/sql", a.runSQL)

					r.Get("/collections", a.listCollections)
					r.Post("/collections", a.createCollection)

					r.Route("/collections/{col}", func(r chi.Router) {
						r.Delete("/", a.dropCollection)
						r.Get("/stats", a.collectionStats)
						r.Get("/schema", a.collectionSchema)

						r.Post("/find", a.findDocuments)
						r.Post("/insert", a.insertDocuments)
						r.Post("/update", a.updateDocuments)
						r.Post("/delete", a.deleteDocuments)
						r.Post("/aggregate", a.aggregate)

						r.Get("/indexes", a.listIndexes)
						r.Post("/indexes", a.createIndex)
						r.Delete("/indexes/{name}", a.dropIndex)
					})
				})
			})
		})
	})

	if a.mcpHandler != nil {
		r.Handle("/mcp", a.mcpHandler)
		r.Handle("/mcp/", a.mcpHandler)
	}

	if webHandler != nil {
		r.Handle("/*", webHandler)
	}
	return r
}

// --- request helpers --------------------------------------------------------

func (a *API) client(r *http.Request) (*mongo.Client, error) {
	return a.mgr.Get(chi.URLParam(r, "id"))
}

func (a *API) dbCollection(r *http.Request) (*mongo.Collection, error) {
	client, err := a.client(r)
	if err != nil {
		return nil, err
	}
	return client.Database(chi.URLParam(r, "db")).Collection(chi.URLParam(r, "col")), nil
}

// dbErr writes err with a status code inferred from its type.
func (a *API) dbErr(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	status := http.StatusInternalServerError

	var cmdErr mongo.CommandError
	var writeErr mongo.WriteException
	var bulkErr mongo.BulkWriteException
	switch {
	case errors.As(err, &cmdErr), errors.As(err, &writeErr), errors.As(err, &bulkErr):
		status = http.StatusBadRequest
	case strings.Contains(err.Error(), "not active"):
		status = http.StatusConflict
	}
	fail(w, status, err)
}
