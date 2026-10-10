package api

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.mongodb.org/mongo-driver/mongo"

	"mongoui/internal/auth"
	"mongoui/internal/autoupdate"
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
	auth       *auth.Manager
	settings   *config.Settings
	updater    *autoupdate.Updater
}

// New builds an API instance. mcpHandler, when non-nil, is mounted at /mcp;
// authManager, when non-nil, guards the data API with TOTP sessions. settings
// holds the server-wide MCP preferences exposed by /api/mcp.
func New(store *config.Store, mgr *mongoclient.Manager, uiEmbedded bool, version string, mcpHandler http.Handler, authManager *auth.Manager, settings ...*config.Settings) *API {
	var s *config.Settings
	if len(settings) > 0 && settings[0] != nil {
		s = settings[0]
	} else {
		s = config.NewSettings(config.DefaultMCPSettings())
	}
	return &API{store: store, mgr: mgr, uiEmbedded: uiEmbedded, version: version, mcpHandler: mcpHandler, auth: authManager, settings: s}
}

// SetUpdater attaches the self-updater so the update endpoints can report and
// trigger it. It may be nil (e.g. in tests), in which case those endpoints
// report that the updater is unavailable.
func (a *API) SetUpdater(u *autoupdate.Updater) {
	a.updater = u
}

// Router returns the fully configured HTTP handler.
func (a *API) Router(webHandler http.Handler) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)
	// Cross-origin access is opt-in. Without MONGOUI_ALLOW_ORIGIN the API is
	// same-origin only (no CORS headers), which stops a random website from
	// reading or writing this server through the user's browser.
	if origins := allowOrigins(); len(origins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   origins,
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
			ExposedHeaders:   []string{"Link", "Mcp-Session-Id"},
			AllowCredentials: false,
			MaxAge:           300,
		}))
	}

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			ok(w, map[string]any{
				"status":     "ok",
				"version":    a.version,
				"uiEmbedded": a.uiEmbedded,
			})
		})

		if a.auth != nil {
			r.Mount("/auth", a.auth.Routes())
		}

		r.Group(func(r chi.Router) {
			if a.auth != nil {
				r.Use(a.auth.Middleware)
			}

			r.Get("/mcp", a.getMCPSettings)
			r.Put("/mcp", a.updateMCPSettings)

			r.Get("/update", a.getUpdate)
			r.Put("/update", a.updateUpdateSettings)
			r.Post("/update/check", a.checkUpdate)
			r.Post("/update/install", a.installUpdate)

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
							r.Post("/explain", a.explain)
							r.Post("/export", a.exportDocuments)
							r.Post("/import", a.importDocuments)
							r.Post("/copy", a.copyCollection)

							r.Get("/indexes", a.listIndexes)
							r.Post("/indexes", a.createIndex)
							r.Patch("/indexes/{name}", a.updateIndex)
							r.Delete("/indexes/{name}", a.dropIndex)
						})
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

// securityHeaders sets a few conservative response headers. A strict CSP is
// intentionally omitted because the SPA shell relies on an inline bootstrap
// script.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// allowOrigins reads MONGOUI_ALLOW_ORIGIN (comma separated). Empty means
// same-origin only.
func allowOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("MONGOUI_ALLOW_ORIGIN"))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

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
