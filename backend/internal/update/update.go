// Package update implements a self-updater for the mongoui binary. It resolves
// the latest GitHub release, downloads the archive matching the current
// platform, verifies its checksum and atomically replaces the running binary.
package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// DefaultRepo is the GitHub repository releases are fetched from.
const DefaultRepo = "dolphinZzv/mongoUI"

const userAgent = "mongoui-updater"

var httpClient = &http.Client{Timeout: 120 * time.Second}

// Options configures a Run call.
type Options struct {
	Repo           string
	CurrentVersion string
	TargetVersion  string // empty means "latest"
	CheckOnly      bool
	Force          bool
	Out            io.Writer
}

type release struct {
	TagName string  `json:"tag_name"`
	Name    string  `json:"name"`
	Assets  []asset `json:"assets"`
}

type asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Run checks for (and optionally installs) a newer release.
func Run(opts Options) error {
	out := opts.Out
	if out == nil {
		out = io.Discard
	}
	repo := opts.Repo
	if repo == "" {
		repo = DefaultRepo
	}

	rel, err := fetchRelease(repo, opts.TargetVersion)
	if err != nil {
		return err
	}

	latest := normalizeVersion(rel.TagName)
	current := normalizeVersion(opts.CurrentVersion)

	fmt.Fprintf(out, "current version: %s\n", opts.CurrentVersion)
	fmt.Fprintf(out, "latest version:  %s\n", rel.TagName)

	if opts.CheckOnly {
		if isNewer(latest, current) {
			fmt.Fprintf(out, "\nUpdate available: %s -> %s\n", opts.CurrentVersion, rel.TagName)
			fmt.Fprintf(out, "Run `mongoui update` to install it.\n")
		} else {
			fmt.Fprintf(out, "\nAlready up to date.\n")
		}
		return nil
	}

	if !opts.Force && !isNewer(latest, current) {
		fmt.Fprintf(out, "\nAlready up to date (use -force to reinstall).\n")
		return nil
	}

	selected, err := pickAsset(rel, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}

	fmt.Fprintf(out, "\ndownloading %s ...\n", selected.Name)
	archive, err := download(selected.BrowserDownloadURL)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "downloaded %.1f MiB\n", float64(len(archive))/1024/1024)

	if err := verifyChecksum(rel, selected.Name, archive, out); err != nil {
		return err
	}

	if err := replaceSelf(archive, selected.Name, out); err != nil {
		return err
	}

	fmt.Fprintf(out, "\nUpdated to %s. Restart mongoui to use the new version.\n", rel.TagName)
	return nil
}

func fetchRelease(repo, target string) (release, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	if target != "" {
		tag := target
		if !strings.HasPrefix(tag, "v") {
			tag = "v" + tag
		}
		url = fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", repo, tag)
	}

	body, err := download(url)
	if err != nil {
		return release{}, fmt.Errorf("cannot query GitHub releases: %w", err)
	}

	var rel release
	if err := json.Unmarshal(body, &rel); err != nil {
		return release{}, fmt.Errorf("invalid GitHub response: %w", err)
	}
	if rel.TagName == "" {
		return release{}, errors.New("no releases found; publish a version tag first")
	}
	return rel, nil
}

func download(url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/vnd.github+json")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s for %s", resp.Status, url)
	}
	return io.ReadAll(resp.Body)
}

func pickAsset(rel release, goos, goarch string) (asset, error) {
	suffix := fmt.Sprintf("_%s_%s", goos, goarch)
	// Prefer the platform default archive format.
	preferred := ".tar.gz"
	if goos == "windows" {
		preferred = ".zip"
	}
	var fallback *asset
	for i := range rel.Assets {
		a := rel.Assets[i]
		if !strings.Contains(a.Name, suffix) {
			continue
		}
		if strings.HasSuffix(a.Name, preferred) {
			return a, nil
		}
		if strings.HasSuffix(a.Name, ".tar.gz") || strings.HasSuffix(a.Name, ".zip") {
			fallback = &a
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	return asset{}, fmt.Errorf("no release asset found for %s/%s", goos, goarch)
}

func verifyChecksum(rel release, assetName string, data []byte, out io.Writer) error {
	var checksumsURL string
	for _, a := range rel.Assets {
		if a.Name == "checksums.txt" {
			checksumsURL = a.BrowserDownloadURL
			break
		}
	}
	if checksumsURL == "" {
		fmt.Fprintf(out, "warning: checksums.txt not found; skipping verification\n")
		return nil
	}

	body, err := download(checksumsURL)
	if err != nil {
		return fmt.Errorf("cannot download checksums: %w", err)
	}

	want := ""
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == assetName {
			want = strings.ToLower(fields[0])
			break
		}
	}
	if want == "" {
		fmt.Fprintf(out, "warning: no checksum for %s; skipping verification\n", assetName)
		return nil
	}

	sum := sha256.Sum256(data)
	got := hex.EncodeToString(sum[:])
	if got != want {
		return fmt.Errorf("checksum mismatch for %s (expected %s, got %s)", assetName, want, got)
	}
	fmt.Fprintf(out, "checksum verified\n")
	return nil
}

func replaceSelf(archive []byte, assetName string, out io.Writer) error {
	binaryName := "mongoui"
	if runtime.GOOS == "windows" {
		binaryName = "mongoui.exe"
	}

	bin, err := extractBinary(archive, assetName, binaryName)
	if err != nil {
		return err
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot resolve current executable: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}

	dir := filepath.Dir(exePath)
	tmp, err := os.CreateTemp(dir, ".mongoui-update-*")
	if err != nil {
		return fmt.Errorf("cannot create temporary file in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(bin); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	// On Windows the running binary cannot be overwritten directly, so move it
	// aside first.
	if runtime.GOOS == "windows" {
		_ = os.Rename(exePath, exePath+".old")
	}
	if err := os.Rename(tmpPath, exePath); err != nil {
		return fmt.Errorf("cannot replace %s: %w", exePath, err)
	}

	fmt.Fprintf(out, "installed -> %s\n", exePath)
	return nil
}

func extractBinary(archive []byte, assetName, binaryName string) ([]byte, error) {
	if strings.HasSuffix(assetName, ".zip") {
		return extractZip(archive, binaryName)
	}
	return extractTarGz(archive, binaryName)
}

func extractTarGz(archive []byte, binaryName string) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, fmt.Errorf("invalid gzip archive: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid tar archive: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if filepath.Base(header.Name) != binaryName {
			continue
		}
		return io.ReadAll(tr)
	}
	return nil, fmt.Errorf("%s not found in archive", binaryName)
}

func extractZip(archive []byte, binaryName string) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, fmt.Errorf("invalid zip archive: %w", err)
	}
	for _, file := range zr.File {
		if file.FileInfo().IsDir() || filepath.Base(file.Name) != binaryName {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(rc)
	}
	return nil, fmt.Errorf("%s not found in archive", binaryName)
}

// --- version helpers --------------------------------------------------------

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	switch v {
	case "", "dev", "none", "unknown":
		return "0.0.0"
	}
	return v
}

func isNewer(latest, current string) bool {
	l := parseSemver(latest)
	c := parseSemver(current)
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	// Same numeric version: a release without a pre-release suffix wins over
	// one with a suffix (e.g. 1.0.0 > 1.0.0-rc1).
	lpre := strings.Contains(latest, "-")
	cpre := strings.Contains(current, "-")
	if lpre != cpre {
		return !lpre
	}
	return false
}

func parseSemver(v string) [3]int {
	v = normalizeVersion(v)
	v = strings.SplitN(v, "-", 2)[0]
	v = strings.SplitN(v, "+", 2)[0]
	parts := strings.Split(v, ".")
	var out [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
		out[i] = n
	}
	return out
}
