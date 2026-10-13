import { isPlainObject } from "@/lib/mongo"

/**
 * Best-effort translators from a MongoDB query to SQL / mongosh snippets.
 *
 * SQL cannot express every MongoDB construct, so `toSQL` returns a SQL comment
 * explaining what it could not translate instead of producing a wrong query.
 */

export interface QueryTextOptions {
  filter?: string
  sort?: string
  projection?: string
  skip?: number
  limit?: number
}

function parseObject(input?: string): Record<string, unknown> | null {
  const text = (input ?? "").trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  if (isPlainObject(value)) {
    if ("$oid" in value) return `'${String(value.$oid).replace(/'/g, "''")}'`
    if ("$date" in value) return `'${String(value.$date).replace(/'/g, "''")}'`
  }
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

function fieldExpression(key: string, value: unknown): string | null {
  const column = quoteIdent(key)
  if (isPlainObject(value)) {
    const operators = Object.keys(value).filter((operator) => operator.startsWith("$"))
    if (operators.length > 0) {
      const parts: string[] = []
      for (const operator of operators) {
        const operand = value[operator]
        switch (operator) {
          case "$eq":
            parts.push(`${column} = ${sqlValue(operand)}`)
            break
          case "$ne":
            parts.push(`${column} <> ${sqlValue(operand)}`)
            break
          case "$gt":
            parts.push(`${column} > ${sqlValue(operand)}`)
            break
          case "$gte":
            parts.push(`${column} >= ${sqlValue(operand)}`)
            break
          case "$lt":
            parts.push(`${column} < ${sqlValue(operand)}`)
            break
          case "$lte":
            parts.push(`${column} <= ${sqlValue(operand)}`)
            break
          case "$in":
            if (!Array.isArray(operand)) return null
            parts.push(`${column} IN (${operand.map(sqlValue).join(", ")})`)
            break
          case "$nin":
            if (!Array.isArray(operand)) return null
            parts.push(`${column} NOT IN (${operand.map(sqlValue).join(", ")})`)
            break
          case "$regex":
            parts.push(`${column} REGEXP ${sqlValue(operand)}`)
            break
          case "$exists":
            parts.push(operand ? `${column} IS NOT NULL` : `${column} IS NULL`)
            break
          default:
            return null
        }
      }
      return parts.length ? parts.join(" AND ") : null
    }
  }
  return `${column} = ${sqlValue(value)}`
}

function whereClause(filter: Record<string, unknown>): string | null {
  const parts: string[] = []
  for (const [key, value] of Object.entries(filter)) {
    if ((key === "$and" || key === "$or") && Array.isArray(value)) {
      const sub = value.map((item) => (isPlainObject(item) ? whereClause(item) : null))
      if (sub.some((clause) => clause === null)) return null
      parts.push(`(${sub.join(key === "$and" ? " AND " : " OR ")})`)
      continue
    }
    if (key.startsWith("$")) return null
    const expression = fieldExpression(key, value)
    if (!expression) return null
    parts.push(expression)
  }
  return parts.length ? parts.join(" AND ") : ""
}

function selectClause(projection: Record<string, unknown> | null): string {
  if (!projection) return "*"
  const included = Object.entries(projection)
    .filter(([key, value]) => (value === 1 || value === true) && key !== "_id")
    .map(([key]) => quoteIdent(key))
  return included.length > 0 ? included.join(", ") : "*"
}

function orderClause(sort: Record<string, unknown> | null): string {
  if (!sort) return ""
  const parts: string[] = []
  for (const [key, value] of Object.entries(sort)) {
    const direction = value === -1 || value === "desc" || value === "descending" ? "DESC" : "ASC"
    parts.push(`${quoteIdent(key)} ${direction}`)
  }
  return parts.join(", ")
}

/** Renders the current query as a SQL SELECT (best-effort). */
export function toSQL(collection: string, options: QueryTextOptions): string {
  const filter = parseObject(options.filter)
  const projection = parseObject(options.projection)
  const sort = parseObject(options.sort)
  if (!filter || !projection || !sort) return "-- could not parse the filter, sort or projection as JSON"
  const where = whereClause(filter)
  if (where === null) {
    return "-- this filter uses operators that cannot be expressed as SQL"
  }
  let sql = `SELECT ${selectClause(projection)} FROM ${quoteIdent(collection)}`
  if (where) sql += ` WHERE ${where}`
  const order = orderClause(sort)
  if (order) sql += ` ORDER BY ${order}`
  if (options.limit) sql += ` LIMIT ${options.limit}`
  if (options.skip) sql += ` OFFSET ${options.skip}`
  return `${sql};`
}

/** Renders the current query as a mongosh `db.<collection>.find(...)` chain. */
export function toFindJS(collection: string, options: QueryTextOptions): string {
  const filter = (options.filter ?? "").trim() || "{}"
  const projection = (options.projection ?? "").trim()
  const sort = (options.sort ?? "").trim()
  let chain = `db.${collection}.find(${filter}${projection ? `, ${projection}` : ""})`
  if (sort) chain += `.sort(${sort})`
  if (options.skip) chain += `.skip(${options.skip})`
  if (options.limit) chain += `.limit(${options.limit})`
  return chain
}

/** Renders an aggregation pipeline as a mongosh `db.<collection>.aggregate(...)`. */
export function toAggregateJS(collection: string, pipeline: string): string {
  const text = pipeline.trim() || "[]"
  return `db.${collection}.aggregate(${text})`
}
