import * as React from "react"
import { createPortal } from "react-dom"
import { Wand2 } from "lucide-react"

import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A MongoDB filter editor with syntax highlighting, operator completion and
 * common-query templates.
 *
 * Like the SQL editor it overlays a transparent <textarea> on a highlighted
 * <pre>, so no editor dependency is added. Completion knows about query
 * operators (with a short description), BSON extended-JSON helpers and the
 * field names passed in by the caller.
 */

const CLS = {
  key: "text-sky-700 dark:text-sky-300",
  operator: "text-violet-600 dark:text-violet-400 font-medium",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  literal: "text-rose-600 dark:text-rose-400",
  punct: "text-muted-foreground",
}

/** Query + BSON operators, with a short hint shown in the completion menu. */
export const MONGO_OPERATORS: { text: string; detail: string }[] = [
  { text: "$eq", detail: "equals" },
  { text: "$ne", detail: "not equal" },
  { text: "$gt", detail: "greater than" },
  { text: "$gte", detail: "greater than or equal" },
  { text: "$lt", detail: "less than" },
  { text: "$lte", detail: "less than or equal" },
  { text: "$in", detail: "matches any value in an array" },
  { text: "$nin", detail: "matches none of the values" },
  { text: "$exists", detail: "field exists" },
  { text: "$type", detail: "matches a BSON type" },
  { text: "$regex", detail: "regular expression match" },
  { text: "$options", detail: "regex options (i, m, s, x)" },
  { text: "$all", detail: "array contains all values" },
  { text: "$elemMatch", detail: "at least one array element matches" },
  { text: "$size", detail: "array has this many elements" },
  { text: "$mod", detail: "modulo [divisor, remainder]" },
  { text: "$not", detail: "negates an operator expression" },
  { text: "$and", detail: "all sub-expressions match" },
  { text: "$or", detail: "any sub-expression matches" },
  { text: "$nor", detail: "none of the sub-expressions match" },
  { text: "$expr", detail: "aggregation expression boolean" },
  { text: "$text", detail: "full-text search" },
  { text: "$where", detail: "JavaScript predicate (limited)" },
  { text: "$comment", detail: "attach a comment to the query" },
  { text: "$oid", detail: "ObjectId value" },
  { text: "$date", detail: "date value" },
  { text: "$numberInt", detail: "32-bit integer value" },
  { text: "$numberLong", detail: "64-bit integer value" },
  { text: "$numberDouble", detail: "double value" },
  { text: "$numberDecimal", detail: "Decimal128 value" },
  { text: "$binary", detail: "binary value" },
  { text: "$regularExpression", detail: "regex value" },
  { text: "$timestamp", detail: "timestamp value" },
  { text: "$uuid", detail: "UUID value" },
  { text: "$minKey", detail: "min key value" },
  { text: "$maxKey", detail: "max key value" },
]

/** Ready-to-use filter snippets offered as chips / in the templates menu. */
export const FILTER_TEMPLATES: { labelKey: string; value: string }[] = [
  { labelKey: "filter.tpl.equals", value: '{ "field": "value" }' },
  { labelKey: "filter.tpl.compare", value: '{ "field": { "$gt": 0 } }' },
  { labelKey: "filter.tpl.in", value: '{ "field": { "$in": ["a", "b"] } }' },
  { labelKey: "filter.tpl.regex", value: '{ "field": { "$regex": "^abc", "$options": "i" } }' },
  { labelKey: "filter.tpl.exists", value: '{ "field": { "$exists": true } }' },
  { labelKey: "filter.tpl.or", value: '{ "$or": [ { "a": 1 }, { "b": 2 } ] }' },
  { labelKey: "filter.tpl.and", value: '{ "$and": [ { "a": 1 }, { "b": 2 } ] }' },
  {
    labelKey: "filter.tpl.date",
    value: '{ "createdAt": { "$gte": { "$date": "2024-01-01T00:00:00Z" } } }',
  },
  { labelKey: "filter.tpl.objectId", value: '{ "_id": { "$oid": "507f1f77bcf86cd799439011" } }' },
]

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r"
}

function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_$.]/.test(c)
}

interface Token {
  text: string
  cls: string
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const n = input.length
  let i = 0
  const push = (text: string, cls: string) => tokens.push({ text, cls })

  while (i < n) {
    const c = input[i]

    if (isSpace(c)) {
      let j = i
      while (j < n && isSpace(input[j])) j++
      push(input.slice(i, j), "")
      i = j
      continue
    }

    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (input[j] === "\\") {
          j += 2
          continue
        }
        if (input[j] === '"') {
          j++
          break
        }
        j++
      }
      const text = input.slice(i, j)
      let k = j
      while (k < n && isSpace(input[k])) k++
      const inner = text.slice(1, -1)
      if (input[k] === ":") {
        push(text, inner.startsWith("$") ? CLS.operator : CLS.key)
      } else {
        push(text, CLS.string)
      }
      i = j
      continue
    }

    if ((c >= "0" && c <= "9") || (c === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1
      while (j < n && /[0-9eE+\-.]/.test(input[j])) j++
      push(input.slice(i, j), CLS.number)
      i = j
      continue
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(input[j])) j++
      const word = input.slice(i, j)
      if (word.startsWith("$")) push(word, CLS.operator)
      else if (word === "true" || word === "false" || word === "null") push(word, CLS.literal)
      else push(word, CLS.key)
      i = j
      continue
    }

    if ("{}[],:".includes(c)) {
      push(c, CLS.punct)
      i++
      continue
    }

    push(c, "")
    i++
  }
  return tokens
}

export function highlightMongo(input: string): string {
  return tokenize(input)
    .map((t) => (t.cls ? `<span class="${t.cls}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text)))
    .join("")
}

interface Completion {
  items: { text: string; detail: string }[]
  index: number
  start: number
  prefix: string
  top: number
  left: number
}

interface MongoFilterEditorProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  placeholder?: string
  id?: string
  className?: string
  autoFocus?: boolean
  /** Field names to complete, e.g. the columns of the current result page. */
  suggestions?: string[]
  /** Hide the templates dropdown. */
  hideTemplates?: boolean
}

const MENU_WIDTH = 280
const MENU_MAX_HEIGHT = 240

export function MongoFilterEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  id,
  className,
  autoFocus,
  suggestions = [],
  hideTemplates = false,
}: MongoFilterEditorProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const preRef = React.useRef<HTMLPreElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [completion, setCompletion] = React.useState<Completion | null>(null)
  const [templatesOpen, setTemplatesOpen] = React.useState(false)
  const dismissedRef = React.useRef(false)
  const { t } = useI18n()

  const allItems = React.useMemo(() => {
    const items: { text: string; detail: string; rank: number }[] = []
    const seen = new Set<string>()
    for (const field of suggestions) {
      const key = field.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ text: field, detail: "field", rank: 0 })
    }
    for (const op of MONGO_OPERATORS) {
      const key = op.text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ text: op.text, detail: op.detail, rank: 1 })
    }
    return items
  }, [suggestions])

  const syncScroll = React.useCallback(() => {
    const pre = preRef.current
    const textarea = textareaRef.current
    if (!pre || !textarea) return
    pre.scrollTop = textarea.scrollTop
    pre.scrollLeft = textarea.scrollLeft
  }, [])

  const caretPosition = React.useCallback((text: string, caret: number) => {
    const textarea = textareaRef.current
    const container = containerRef.current
    if (!textarea || !container) return { top: 0, left: 0 }
    const style = window.getComputedStyle(textarea)
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    let charWidth = 7
    if (ctx) {
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      charWidth = ctx.measureText("M").width || 7
    }
    const lineHeight = parseFloat(style.lineHeight) || 18
    const padTop = parseFloat(style.paddingTop) || 0
    const padLeft = parseFloat(style.paddingLeft) || 0

    const lines = text.slice(0, caret).split("\n")
    const line = lines.length - 1
    const col = lines[line].length
    const rect = container.getBoundingClientRect()

    let top = rect.top + padTop + (line + 1) * lineHeight - textarea.scrollTop
    let left = rect.left + padLeft + col * charWidth - textarea.scrollLeft
    const maxLeft = window.innerWidth - MENU_WIDTH - 8
    if (left > maxLeft) left = Math.max(8, maxLeft)
    if (left < 8) left = 8
    if (top + MENU_MAX_HEIGHT > window.innerHeight - 8) {
      top = rect.top + padTop + line * lineHeight - textarea.scrollTop - MENU_MAX_HEIGHT
      if (top < 8) top = 8
    }
    return { top, left }
  }, [])

  const refreshCompletion = React.useCallback(
    (text: string) => {
      const textarea = textareaRef.current
      if (!textarea || dismissedRef.current) {
        if (!textarea) setCompletion(null)
        return
      }
      const caret = textarea.selectionStart ?? text.length
      let start = caret
      while (start > 0 && isIdentPart(text[start - 1])) start--
      const prefix = text.slice(start, caret)

      // Only suggest for a partial word or right after a structural character.
      if (!prefix) {
        let before = start - 1
        while (before >= 0 && isSpace(text[before])) before--
        const prev = before >= 0 ? text[before] : ""
        if (!"{[,".includes(prev) && before >= 0) {
          setCompletion(null)
          return
        }
      }

      const query = prefix.toLowerCase()
      const items = allItems
        .filter((entry) => entry.text.toLowerCase().startsWith(query))
        .sort((a, b) => a.rank - b.rank || a.text.toLowerCase().localeCompare(b.text.toLowerCase()))
        .slice(0, 20)
        .map(({ text: itemText, detail }) => ({ text: itemText, detail }))
      if (items.length === 0) {
        setCompletion(null)
        return
      }
      const position = caretPosition(text, caret)
      setCompletion((prev) => {
        const same =
          prev !== null &&
          prev.prefix === prefix &&
          prev.items.length === items.length &&
          prev.items.every((item, i) => item.text === items[i].text)
        return {
          items,
          index: same && prev ? Math.min(prev.index, items.length - 1) : 0,
          start,
          prefix,
          ...position,
        }
      })
    },
    [allItems, caretPosition],
  )

  const insert = React.useCallback(
    (text: string, from?: number, to?: number) => {
      const textarea = textareaRef.current
      const caret = textarea?.selectionStart ?? value.length
      const start = from ?? caret
      const end = to ?? textarea?.selectionEnd ?? caret
      const next = value.slice(0, start) + text + value.slice(end)
      onChange(next)
      const pos = start + text.length
      requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange(pos, pos)
        syncScroll()
      })
    },
    [value, onChange, syncScroll],
  )

  const accept = React.useCallback(
    (item: string) => {
      const textarea = textareaRef.current
      if (!textarea || !completion) return
      const caret = textarea.selectionStart ?? value.length
      insert(item, caret - completion.prefix.length, caret)
      dismissedRef.current = true
      setCompletion(null)
    },
    [completion, value, insert],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completion) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setCompletion((c) => (c ? { ...c, index: (c.index + 1) % c.items.length } : c))
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setCompletion((c) =>
          c ? { ...c, index: (c.index - 1 + c.items.length) % c.items.length } : c,
        )
        return
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        accept(completion.items[completion.index].text)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        dismissedRef.current = true
        setCompletion(null)
        return
      }
    }
    onKeyDown?.(event)
  }

  const html = React.useMemo(() => highlightMongo(value) + "\n", [value])

  return (
    <>
      <div className="relative">
        <div
          ref={containerRef}
          className={cn(
            "border-input focus-within:border-ring focus-within:ring-ring/50 relative min-h-9 max-h-[16rem] resize-y overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
            className,
          )}
        >
        <pre
          ref={preRef}
          aria-hidden="true"
          className="scrollbar-thin pointer-events-none absolute inset-0 m-0 overflow-auto p-2 font-mono text-xs leading-relaxed whitespace-pre"
        >
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={textareaRef}
          id={id}
          data-testid="mongo-filter-editor"
          value={value}
          onChange={(event) => {
            const next = event.target.value
            dismissedRef.current = false
            onChange(next)
            refreshCompletion(next)
          }}
          onScroll={() => {
            syncScroll()
            setCompletion(null)
          }}
          onKeyDown={handleKeyDown}
          onClick={() => refreshCompletion(value)}
          onSelect={() => refreshCompletion(value)}
          onBlur={() => setCompletion(null)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          autoFocus={autoFocus}
          className={cn(
            "scrollbar-thin caret-foreground placeholder:text-muted-foreground selection:bg-primary/30 relative block min-h-9 w-full resize-none overflow-auto bg-transparent p-2 font-mono text-xs leading-relaxed whitespace-pre text-transparent outline-none",
            !hideTemplates && "pr-8",
          )}
        />

        {!hideTemplates ? (
          <button
            type="button"
            aria-label={t("filter.templates")}
            title={t("filter.templates")}
            onMouseDown={(event) => {
              event.preventDefault()
              setTemplatesOpen((open) => !open)
            }}
            className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 rounded p-1"
          >
            <Wand2 className="size-3.5" />
          </button>
        ) : null}
        </div>

        {templatesOpen ? (
          <div
            className="bg-popover text-popover-foreground absolute top-full left-0 z-40 mt-1 w-72 rounded-md border p-1 shadow-md"
            onMouseLeave={() => setTemplatesOpen(false)}
          >
            {FILTER_TEMPLATES.map((template) => (
              <button
                key={template.labelKey}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  insert(template.value)
                  setTemplatesOpen(false)
                }}
                className="hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs"
              >
                <span>{t(template.labelKey)}</span>
                <code className="text-muted-foreground truncate font-mono text-[10px]">
                  {template.value}
                </code>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {completion
        ? createPortal(
            <div
              data-testid="mongo-completion"
              role="listbox"
              style={{ top: completion.top, left: completion.left, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
              className="bg-popover text-popover-foreground fixed z-50 overflow-auto rounded-md border p-1 shadow-md"
            >
              {completion.items.map((item, index) => (
                <button
                  key={item.text}
                  type="button"
                  role="option"
                  aria-selected={index === completion.index}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    accept(item.text)
                  }}
                  onMouseEnter={() => setCompletion((c) => (c ? { ...c, index } : c))}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left",
                    index === completion.index
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  <span className="font-mono text-xs">{item.text}</span>
                  <span className="text-muted-foreground truncate text-[10px]">{item.detail}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
