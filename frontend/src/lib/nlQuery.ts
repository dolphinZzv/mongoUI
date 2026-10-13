/**
 * A small, dependency-free natural-language → MongoDB filter parser.
 *
 * It understands the common shapes an operator types, in English or Chinese:
 *
 *   status = active and age >= 18
 *   name contains "ann" or email exists
 *   type in a, b, c
 *   状态 = 失败 且 时间 > 2024-01-01
 *
 * It is intentionally a deterministic rule parser (no model calls), so it works
 * offline and can also be exposed to browser agents as a tool.
 */

export interface NlQueryResult {
  filter: Record<string, unknown>
  /** Number of clauses that were understood. */
  matched: number
}

function stripQuotes(text: string): string {
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
  ]
  for (const [open, close] of pairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length >= 2) {
      return text.slice(1, -1)
    }
  }
  return text
}

function parseValue(raw: string): unknown {
  const text = raw.trim()
  if (!text) return ""
  const unquoted = stripQuotes(text)
  if (unquoted !== text) return unquoted
  if (text === "true" || text === "是") return true
  if (text === "false" || text === "否") return false
  if (text === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseList(raw: string): unknown[] {
  const text = raw.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!text.trim()) return []
  return text.split(",").map((part) => parseValue(part))
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function splitClauses(input: string): { connector: "and" | "or"; clause: string }[] {
  const normalized = input
    .replace(/&&/g, " and ")
    .replace(/\|\|/g, " or ")
    .replace(/且/g, " and ")
    .replace(/或/g, " or ")
  const parts = normalized.split(/\s+(and|or)\s+/i)
  const clauses: { connector: "and" | "or"; clause: string }[] = [
    { connector: "and", clause: parts[0] ?? "" },
  ]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const connector = (parts[i] ?? "and").toLowerCase() === "or" ? "or" : "and"
    clauses.push({ connector, clause: parts[i + 1] ?? "" })
  }
  return clauses.filter((entry) => entry.clause.trim())
}

function parseClause(clause: string): Record<string, unknown> | null {
  const text = clause.trim()
  if (!text) return null

  const comparison = text.match(/^([\w.$]+)\s*(>=|<=|!=|==|=|>|<)\s*(.+)$/)
  if (comparison) {
    const field = comparison[1]
    const operator = comparison[2]
    const value = parseValue(comparison[3])
    switch (operator) {
      case "=":
      case "==":
        return { [field]: value }
      case "!=":
        return { [field]: { $ne: value } }
      case ">":
        return { [field]: { $gt: value } }
      case ">=":
        return { [field]: { $gte: value } }
      case "<":
        return { [field]: { $lt: value } }
      case "<=":
        return { [field]: { $lte: value } }
    }
  }

  const word = text.match(/^([\w.$]+)\s+(contains|like|in|exists|is\s+not|is)\s*(.*)$/i)
  if (word) {
    const field = word[1]
    const operator = word[2].toLowerCase().replace(/\s+/g, " ")
    const rest = word[3].trim()
    if (operator === "contains" || operator === "like") {
      return { [field]: { $regex: escapeRegex(stripQuotes(rest)), $options: "i" } }
    }
    if (operator === "in") return { [field]: { $in: parseList(rest) } }
    if (operator === "exists") return { [field]: { $exists: true } }
    if (operator === "is not") return { [field]: { $ne: parseValue(rest) } }
    if (operator === "is") return { [field]: parseValue(rest) }
  }

  return null
}

export function parseNaturalQuery(input: string): NlQueryResult {
  const clauses = splitClauses(input)
  const parsed = clauses
    .map((entry) => ({ connector: entry.connector, value: parseClause(entry.clause) }))
    .filter((entry): entry is { connector: "and" | "or"; value: Record<string, unknown> } =>
      entry.value !== null,
    )
  if (parsed.length === 0) return { filter: {}, matched: 0 }
  const conditions = parsed.map((entry) => entry.value)
  if (conditions.length === 1) return { filter: conditions[0], matched: 1 }
  const connectors = parsed.slice(1).map((entry) => entry.connector)
  const useOr = connectors.length > 0 && connectors.every((connector) => connector === "or")
  return { filter: { [useOr ? "$or" : "$and"]: conditions }, matched: conditions.length }
}
