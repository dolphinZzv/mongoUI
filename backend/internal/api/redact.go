package api

import (
	"net/url"
	"strings"

	"mongoui/internal/config"
)

// redactConnection returns a copy safe to send in list responses: the URI
// password and the SSH credentials are removed. The full record is only handed
// out by getConnection when the client explicitly opens a connection for
// editing.
func redactConnection(c config.Connection) config.Connection {
	out := c
	out.URI = redactURI(c.URI)
	if c.SSH != nil {
		ssh := *c.SSH
		ssh.Password = ""
		ssh.PrivateKey = ""
		ssh.Passphrase = ""
		out.SSH = &ssh
	}
	return out
}

// redactURI masks the password in a MongoDB connection string.
func redactURI(raw string) string {
	if !strings.Contains(raw, "@") {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		// Unparseable but has an authority: mask everything after the scheme.
		if i := strings.Index(raw, "://"); i >= 0 {
			if j := strings.LastIndex(raw, "@"); j > i {
				return raw[:i+3] + "****" + raw[j:]
			}
		}
		return raw
	}
	user := u.User.Username()
	if _, has := u.User.Password(); has {
		u.User = url.UserPassword(user, "xxxxxxxx")
	}
	return u.String()
}
