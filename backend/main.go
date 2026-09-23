package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"mongoui/internal/api"
	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
	"mongoui/web"
)

// Build metadata, injected via -ldflags by GoReleaser / scripts/build.sh.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	var (
		addr        = flag.String("addr", envOr("MONGOUI_ADDR", ":8080"), "HTTP listen address")
		dataDir     = flag.String("data", envOr("MONGOUI_DATA", "data"), "directory used to store connection profiles")
		webDir      = flag.String("web", "", "serve front-end assets from this directory instead of the embedded build")
		showVersion = flag.Bool("version", false, "print version information and exit")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("mongoui %s (commit %s, built %s)\n", version, commit, date)
		return
	}

	storePath := filepath.Join(*dataDir, "connections.json")
	store, err := config.NewStore(storePath)
	if err != nil {
		log.Fatalf("failed to load connection store: %v", err)
	}

	mgr := mongoclient.NewManager()
	defer mgr.CloseAll()

	uiEmbedded := web.Embedded()
	webHandler := resolveWebHandler(*webDir)
	if webHandler == nil {
		log.Printf("front-end assets not embedded; API only (run `make frontend` or the Vite dev server)")
	} else if uiEmbedded {
		log.Printf("serving embedded front-end")
	} else {
		log.Printf("serving front-end from %s", *webDir)
	}

	handler := api.New(store, mgr, uiEmbedded, version).Router(webHandler)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("mongoui listening on %s", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Printf("shutting down...")
	mgr.CloseAll()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}

// resolveWebHandler prefers an explicit directory, then the embedded build.
func resolveWebHandler(dir string) http.Handler {
	if dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil {
			return spaHandler(os.DirFS(dir))
		}
		log.Printf("web dir %q does not contain index.html", dir)
	}
	if fsys, ok := web.FS(); ok {
		return spaHandler(fsys)
	}
	return nil
}

// spaHandler serves static files and falls back to index.html for client-side
// routing paths.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(fsys, p); err != nil {
			clone := r.Clone(r.Context())
			clone.URL.Path = "/"
			fileServer.ServeHTTP(w, clone)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
