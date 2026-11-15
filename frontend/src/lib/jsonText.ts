/**
 * First JSON parse error, or null when the text is valid (or empty).
 * Adds a 1-based line/column when the browser exposes a character position.
 */
export function jsonError(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return withLocation(text, message)
  }
}

/** Parse error for a filter/sort/projection, which must be a JSON object. */
export function jsonObjectError(value: string): string | null {
  const error = jsonError(value)
  if (error) return error
  const text = value.trim()
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "expected a JSON object, for example { \"status\": \"active\" }"
  }
  return null
}

function withLocation(text: string, message: string): string {
  const byPosition = /position\s+(\d+)/i.exec(message)
  if (byPosition) {
    const position = Math.max(0, Math.min(Number(byPosition[1]), text.length))
    const location = lineColumn(text, position)
    return `line ${location.line}, column ${location.column}: ${message}`
  }
  const byLine = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message)
  if (byLine) {
    return `line ${byLine[1]}, column ${byLine[2]}: ${message}`
  }
  if (/end of JSON input|unexpected end/i.test(message)) {
    const location = lineColumn(text, text.length)
    return `line ${location.line}, column ${location.column}: ${message}`
  }
  const token = /unexpected token '(.+?)'/i.exec(message)?.[1]
  if (token) {
    const position = text.lastIndexOf(token)
    if (position >= 0) {
      const location = lineColumn(text, position)
      return `line ${location.line}, column ${location.column}: ${message}`
    }
  }
  return message
}

function lineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position)
  const lines = before.split("\n")
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}
