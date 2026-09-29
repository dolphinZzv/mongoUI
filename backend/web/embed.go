// Package web exposes the compiled front-end assets embedded into the binary.
package web

import (
	"embed"
	"io/fs"
)

// dist holds the Vite build output. The directory always exists in the
// repository (kept alive by .gitkeep) so that `go build` works even before the
// front-end has been compiled.
//
// Regenerate the assets with either:
//
//	make frontend
//	./scripts/build.sh
//	go generate ./... && go build ./...
//
//go:generate sh -c "cd ../../frontend && npm run build && find ../backend/web/dist -mindepth 1 ! -name .gitkeep -delete && cp -r dist/. ../backend/web/dist/ && sh ../scripts/gzip-assets.sh ../backend/web/dist"
//go:embed all:dist
var dist embed.FS

// FS returns the embedded dist folder and reports whether a real front-end
// build is present (index.html exists). It returns false when only the
// placeholder file ships with the repository.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}

// Embedded reports whether a front-end build is embedded in the binary.
func Embedded() bool {
	_, ok := FS()
	return ok
}
