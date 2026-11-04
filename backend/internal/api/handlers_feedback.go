package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"mongoui/internal/update"
)

const (
	feedbackMaxTitle = 160
	feedbackMaxBody  = 8000
	feedbackTimeout  = 30 * time.Second
)

// feedbackRepoTarget accepts both `OWNER/REPO` and GitHub Enterprise's
// `HOST/OWNER/REPO` form. The gh CLI receives the value as a separate argument,
// never through a shell, so this is a guard against confusing values rather
// than the only line of defence.
var feedbackRepoTarget = regexp.MustCompile(`^([A-Za-z0-9.-]+/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type feedbackInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// submitFeedback opens a GitHub issue through the server's authenticated gh
// CLI. Keeping the token on the server means the browser never needs a GitHub
// credential, while `gh auth login` remains the single setup step.
func (a *API) submitFeedback(w http.ResponseWriter, r *http.Request) {
	var in feedbackInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}

	title := strings.TrimSpace(in.Title)
	body := strings.TrimSpace(in.Body)
	if title == "" {
		badRequest(w, errors.New("feedback title is required"))
		return
	}
	if len([]rune(title)) > feedbackMaxTitle {
		badRequest(w, fmt.Errorf("feedback title must be at most %d characters", feedbackMaxTitle))
		return
	}
	if body == "" {
		badRequest(w, errors.New("feedback details are required"))
		return
	}
	if len([]rune(body)) > feedbackMaxBody {
		badRequest(w, fmt.Errorf("feedback details must be at most %d characters", feedbackMaxBody))
		return
	}

	repo := feedbackRepo()
	if !feedbackRepoTarget.MatchString(repo) {
		fail(w, http.StatusInternalServerError, fmt.Errorf("invalid feedback repository %q", repo))
		return
	}

	issueBody := body + "\n\n---\n\n" +
		"Submitted from the MongoUI feedback dialog.\n\n" +
		fmt.Sprintf("- MongoUI version: %s\n", a.version)

	if ua := strings.TrimSpace(r.UserAgent()); ua != "" {
		issueBody += fmt.Sprintf("- User-Agent: %s\n", ua)
	}

	ctx, cancel := context.WithTimeout(r.Context(), feedbackTimeout)
	defer cancel()
	issueURL, err := createIssue(ctx, repo, title, issueBody)
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, map[string]string{"url": issueURL})
}

// feedbackRepo picks the GitHub repository that receives feedback. An explicit
// feedback override is useful when releases are downloaded from a mirror but
// issues should still go to the upstream project.
func feedbackRepo() string {
	for _, key := range []string{"MONGOUI_FEEDBACK_REPO", "MONGOUI_REPO"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return update.DefaultRepo
}

func createIssue(ctx context.Context, repo, title, body string) (string, error) {
	cmd := exec.CommandContext(ctx, "gh", "issue", "create",
		"--repo", repo,
		"--title", title,
		"--body-file", "-",
	)
	// The body is streamed so long issue descriptions never hit command-line
	// length limits. Prompting is disabled because the server may be headless.
	cmd.Stdin = strings.NewReader(body)
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1")

	out, err := cmd.CombinedOutput()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", errors.New("gh CLI not found; install GitHub CLI and run `gh auth login` on the server")
		}
		detail := truncateCommandOutput(string(out))
		if detail == "" {
			return "", fmt.Errorf("gh issue create failed: %w", err)
		}
		return "", fmt.Errorf("gh issue create failed: %s", detail)
	}
	return issueURL(string(out)), nil
}

func issueURL(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "https://") || strings.HasPrefix(line, "http://") {
			return line
		}
	}
	return ""
}

func truncateCommandOutput(output string) string {
	output = strings.TrimSpace(output)
	const max = 2000
	if len(output) > max {
		return output[:max] + "…"
	}
	return output
}
