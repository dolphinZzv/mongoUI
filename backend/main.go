package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"mongoui/internal/api"
	"mongoui/internal/config"
	"mongoui/internal/daemon"
	"mongoui/internal/mcp"
	"mongoui/internal/mongoclient"
	"mongoui/internal/update"
	"mongoui/web"
)

// Build metadata, injected via -ldflags by GoReleaser / scripts/build.sh.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	// Subcommands must be handled before flag parsing.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "update":
			os.Exit(runUpdate(os.Args[2:]))
		case "mcp":
			os.Exit(runMCP(os.Args[2:]))
		}
	}

	var (
		addr         = flag.String("addr", envOr("MONGOUI_ADDR", ":8080"), "HTTP listen address")
		dataDir      = flag.String("data", envOr("MONGOUI_DATA", "data"), "directory used to store connection profiles")
		webDir       = flag.String("web", "", "serve front-end assets from this directory instead of the embedded build")
		showVersion  = flag.Bool("version", false, "print version information and exit")
		daemonize    = flag.Bool("daemon", false, "run in the background as a daemon (Unix)")
		stopDaemon   = flag.Bool("stop", false, "stop the background process started with -daemon")
		statusDaemon = flag.Bool("status", false, "report whether the background process is running")
		pidFile      = flag.String("pidfile", "", "pid file path (default <data>/mongoui.pid)")
		logFile      = flag.String("logfile", "", "log file path used by -daemon (default <data>/mongoui.log)")
		mcpReadOnly  = flag.Bool("mcp-readonly", envBool("MONGOUI_MCP_READONLY"), "expose only read tools over MCP")
		mcpToken     = flag.String("mcp-token", envOr("MONGOUI_MCP_TOKEN", ""), "require this bearer token for the MCP HTTP endpoint")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("mongoui %s (commit %s, built %s)\n", version, commit, date)
		return
	}

	pidPath := *pidFile
	if pidPath == "" {
		pidPath = filepath.Join(*dataDir, "mongoui.pid")
	}
	logPath := *logFile
	if logPath == "" {
		logPath = filepath.Join(*dataDir, "mongoui.log")
	}
	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatalf("cannot create data directory: %v", err)
	}

	switch {
	case *statusDaemon:
		pid, running, err := daemon.Status(pidPath)
		switch {
		case err != nil:
			fmt.Println("mongoui is not running")
		case running:
			fmt.Printf("mongoui is running (pid %d)\n", pid)
		default:
			fmt.Printf("mongoui is not running (stale pid %d)\n", pid)
		}
		return
	case *stopDaemon:
		if err := daemon.Stop(pidPath); err != nil {
			log.Fatalf("stop failed: %v", err)
		}
		return
	case *daemonize && !daemon.IsChild():
		if err := daemon.Start(daemon.Config{PidFile: pidPath, LogFile: logPath}); err != nil {
			log.Fatalf("cannot start daemon: %v", err)
		}
		return
	case *daemonize && daemon.IsChild():
		if err := daemon.WritePid(pidPath); err != nil {
			log.Fatalf("cannot write pid file: %v", err)
		}
		defer daemon.RemovePid(pidPath)
	}

	storePath := filepath.Join(*dataDir, "connections.json")
	key, err := config.LoadKey(*dataDir)
	if err != nil {
		log.Fatalf("cannot load secret key: %v", err)
	}
	cipher, err := config.NewCipher(key)
	if err != nil {
		log.Fatalf("cannot initialise cipher: %v", err)
	}
	store, err := config.NewStoreWithSecret(storePath, cipher)
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

	handler := api.New(store, mgr, uiEmbedded, version, mcp.New(store, mgr, version, *mcpToken, *mcpReadOnly).HTTPHandler()).Router(webHandler)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("mongoui %s listening on %s", version, *addr)
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

// runMCP implements the `mongoui mcp` subcommand: an MCP server over stdio.
func runMCP(args []string) int {
	flags := flag.NewFlagSet("mcp", flag.ContinueOnError)
	dataDir := flags.String("data", envOr("MONGOUI_DATA", "data"), "directory used to store connection profiles")
	readOnly := flags.Bool("read-only", envBool("MONGOUI_MCP_READONLY"), "only expose read tools")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "cannot create data directory: %v\n", err)
		return 1
	}
	key, err := config.LoadKey(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot load secret key: %v\n", err)
		return 1
	}
	cipher, err := config.NewCipher(key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot initialise cipher: %v\n", err)
		return 1
	}
	store, err := config.NewStoreWithSecret(filepath.Join(*dataDir, "connections.json"), cipher)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load connection store: %v\n", err)
		return 1
	}
	mgr := mongoclient.NewManager()
	defer mgr.CloseAll()

	srv := mcp.New(store, mgr, version, "", *readOnly)
	if err := srv.ServeStdio(context.Background(), os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server: %v\n", err)
		return 1
	}
	return 0
}

// runUpdate implements the `mongoui update` subcommand.
func runUpdate(args []string) int {
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	check := flags.Bool("check", false, "only check whether a newer version exists")
	force := flags.Bool("force", false, "reinstall even if already up to date")
	repo := flags.String("repo", envOr("MONGOUI_REPO", update.DefaultRepo), "GitHub repository (owner/name)")
	target := flags.String("version", "", "install a specific version (default: latest)")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	err := update.Run(update.Options{
		Repo:           *repo,
		CurrentVersion: version,
		TargetVersion:  *target,
		CheckOnly:      *check,
		Force:          *force,
		Out:            os.Stdout,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "update failed: %v\n", err)
		return 1
	}
	return 0
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

		// Serve the exact file when present (index.html, favicon, ...).
		if _, err := fs.Stat(fsys, p); err == nil {
			setCacheHeaders(w, p)
			fileServer.ServeHTTP(w, r)
			return
		}

		// Front-end assets are stored gzip-compressed to keep the binary small;
		// hand the compressed bytes to the browser with Content-Encoding: gzip.
		if strings.HasPrefix(p, "assets/") {
			if data, err := fs.ReadFile(fsys, p+".gz"); err == nil {
				if ct := mime.TypeByExtension(path.Ext(p)); ct != "" {
					w.Header().Set("Content-Type", ct)
				}
				w.Header().Set("Content-Encoding", "gzip")
				w.Header().Set("Vary", "Accept-Encoding")
				setCacheHeaders(w, p)
				w.Header().Set("Content-Length", strconv.Itoa(len(data)))
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(data)
				return
			}
			// A missing static asset is a real 404, never the SPA shell.
			http.NotFound(w, r)
			return
		}

		// Client-side route: serve the SPA shell. Never cache it so the browser
		// always picks up the latest hashed asset references.
		w.Header().Set("Cache-Control", "no-cache")
		clone := r.Clone(r.Context())
		clone.URL.Path = "/"
		fileServer.ServeHTTP(w, clone)
	})
}

func setCacheHeaders(w http.ResponseWriter, p string) {
	switch {
	case p == "index.html":
		// The shell references content-hashed assets, so it must be revalidated
		// on every load to avoid serving a stale UI after an upgrade.
		w.Header().Set("Cache-Control", "no-cache")
	case strings.HasPrefix(p, "assets/"):
		// Vite output filenames contain a content hash: safe to cache
		// aggressively.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envBool reports true when the environment variable is set to a truthy value.
func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
