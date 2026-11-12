/** First JSON parse error, or null when the text is valid (or empty). */
export function jsonError(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
