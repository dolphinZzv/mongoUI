package update

import "testing"

func TestNewer(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v0.2.20", "0.2.19", true},
		{"v0.2.20", "v0.2.20", false},
		{"v0.2.20", "0.2.20-dirty", true},
		{"v0.3.0", "0.2.99", true},
		{"v0.2.20", "dev", true},
		{"v0.2.20", "0.2.20-rc1", true},
	}
	for _, c := range cases {
		if got := Newer(c.latest, c.current); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestIsReleaseVersion(t *testing.T) {
	for _, v := range []string{"0.2.20", "v0.2.20", "v0.2.20-dirty"} {
		if !IsReleaseVersion(v) {
			t.Errorf("IsReleaseVersion(%q) = false, want true", v)
		}
	}
	for _, v := range []string{"", "dev", "ci", "none", "unknown", "snapshot"} {
		if IsReleaseVersion(v) {
			t.Errorf("IsReleaseVersion(%q) = true, want false", v)
		}
	}
}
