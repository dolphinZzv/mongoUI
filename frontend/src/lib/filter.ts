/**
 * Sidebar filter matcher.
 *
 * Three forms are supported, in order:
 *   1. `/pattern/flags` — a JavaScript regular expression.
 *   2. `*` / `?` — a case-insensitive glob over the whole name.
 *   3. plain text — a case-insensitive substring (the original behaviour).
 */

const VALID_FLAGS = /^[dgimsuvy]*$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function compileRegex(query: string): RegExp | null {
  const end = query.lastIndexOf("/")
  if (end <= 0) return null
  const flags = query.slice(end + 1)
  if (!VALID_FLAGS.test(flags)) return null
  try {
    return new RegExp(query.slice(1, end), flags)
  } catch {
    return null
  }
}

function compileGlob(query: string): RegExp {
  let body = ""
  for (let i = 0; i < query.length; i += 1) {
    const char = query[i]
    if (char === "\\" && i + 1 < query.length) {
      i += 1
      body += escapeRegExp(query[i])
    } else if (char === "*") {
      body += ".*"
    } else if (char === "?") {
      body += "."
    } else {
      body += escapeRegExp(char)
    }
  }
  return new RegExp(`^${body}$`, "i")
}

export function compileTextFilter(input: string): (value: string) => boolean {
  const query = input.trim()
  if (!query) return () => true

  if (query.startsWith("/")) {
    const regex = compileRegex(query)
    if (regex) {
      return (value) => {
        // `g` / `y` regexes keep state between tests, so reset it each time.
        regex.lastIndex = 0
        return regex.test(value)
      }
    }
  }

  if (query.includes("*") || query.includes("?")) {
    const regex = compileGlob(query)
    return (value) => regex.test(value)
  }

  const needle = query.toLowerCase()
  return (value) => value.toLowerCase().includes(needle)
}
