import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

/**
 * A small SQL editor with syntax highlighting and completion.
 *
 * It pairs a transparent <textarea> with a highlighted <pre> rendered behind it
 * and keeps their scroll positions in sync. Completion is a lightweight popup
 * over SQL keywords / functions plus any extra identifiers (collections, field
 * names) passed in by the caller. No editor dependency is added, which keeps the
 * embedded bundle small.
 */

const KEYWORDS = [
  "SELECT", "DISTINCT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER",
  "ASC", "DESC", "LIMIT", "OFFSET", "AND", "OR", "NOT", "IN", "LIKE", "IS",
  "NULL", "TRUE", "FALSE", "AS",
]

const FUNCTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX"]

const KEYWORD_SET = new Set(KEYWORDS)
const FUNCTION_SET = new Set(FUNCTIONS)

// Keywords after which an empty prefix still offers suggestions.
const COMPLETE_AFTER = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "AND", "OR",
  "NOT", "IN", "LIKE", "IS", "AS", "DISTINCT",
])

const CLS = {
  keyword: "text-violet-600 dark:text-violet-400 font-medium",
  function: "text-amber-600 dark:text-amber-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-sky-600 dark:text-sky-400",
  comment: "text-muted-foreground italic",
  operator: "text-rose-600 dark:text-rose-400",
  ident: "text-cyan-700 dark:text-cyan-300",
  punct: "text-muted-foreground",
}

interface Token {
  text: string
  cls: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r"
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c)
}

function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c)
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  const n = sql.length
  let i = 0

  const push = (text: string, cls: string) => tokens.push({ text, cls })

  while (i < n) {
    const c = sql[i]

    if (isSpace(c)) {
      let j = i
      while (j < n && isSpace(sql[j])) j++
      push(sql.slice(i, j), "")
      i = j
      continue
    }

    if (c === "-" && sql[i + 1] === "-") {
      let j = i
      while (j < n && sql[j] !== "\n") j++
      push(sql.slice(i, j), CLS.comment)
      i = j
      continue
    }

    if (c === "/" && sql[i + 1] === "*") {
      let j = i + 2
      while (j < n && !(sql[j] === "*" && sql[j + 1] === "/")) j++
      j = Math.min(n, j + 2)
      push(sql.slice(i, j), CLS.comment)
      i = j
      continue
    }

    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "\\") {
          j += 2
          continue
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      push(sql.slice(i, j), CLS.string)
      i = j
      continue
    }

    if (c === "`") {
      let j = i + 1
      while (j < n && sql[j] !== "`") j++
      j = Math.min(n, j + 1)
      push(sql.slice(i, j), CLS.ident)
      i = j
      continue
    }

    if (isDigit(c) || (c === "." && isDigit(sql[i + 1] ?? ""))) {
      let j = i
      while (j < n && (isDigit(sql[j]) || sql[j] === ".")) j++
      if (sql[j] === "e" || sql[j] === "E") {
        j++
        if (sql[j] === "+" || sql[j] === "-") j++
        while (j < n && isDigit(sql[j])) j++
      }
      push(sql.slice(i, j), CLS.number)
      i = j
      continue
    }

    if (isIdentStart(c)) {
      let j = i
      while (j < n && isIdentPart(sql[j])) j++
      const word = sql.slice(i, j)
      const upper = word.toUpperCase()
      let k = j
      while (k < n && isSpace(sql[k])) k++
      if (FUNCTION_SET.has(upper)) {
        push(word, CLS.function)
      } else if (KEYWORD_SET.has(upper)) {
        push(word, CLS.keyword)
      } else if (sql[k] === "(") {
        push(word, CLS.function)
      } else {
        push(word, CLS.ident)
      }
      i = j
      continue
    }

    if ("=<>!".includes(c)) {
      let j = i + 1
      if ("=<>".includes(sql[j] ?? "")) j++
      push(sql.slice(i, j), CLS.operator)
      i = j
      continue
    }

    push(c, CLS.punct)
    i++
  }

  return tokens
}

/** Renders SQL to highlighted HTML. */
export function highlightSql(sql: string): string {
  return tokenize(sql)
    .map((token) =>
      token.cls ? `<span class="${token.cls}">${escapeHtml(token.text)}</span>` : escapeHtml(token.text),
    )
    .join("")
}

/** The word being typed at the caret, or null when completion should not fire. */
function completionContext(sql: string, caret: number): { start: number; prefix: string } | null {
  const tokens = tokenize(sql.slice(0, caret))
  let last: Token | null = null
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].text.trim() !== "") {
      last = tokens[i]
      break
    }
  }
  if (last && (last.cls === CLS.comment || last.cls === CLS.string)) return null

  let start = caret
  while (start > 0 && isIdentPart(sql[start - 1])) start--
  const prefix = sql.slice(start, caret)
  if (prefix.length > 0) {
    return isIdentStart(prefix[0]) ? { start, prefix } : null
  }
  if (last && last.cls === CLS.keyword && COMPLETE_AFTER.has(last.text.toUpperCase())) {
    return { start, prefix: "" }
  }
  return null
}

interface Completion {
  items: string[]
  index: number
  start: number
  prefix: string
  top: number
  left: number
}

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  placeholder?: string
  id?: string
  className?: string
  autoFocus?: boolean
  /** Extra identifiers to complete, e.g. collection and field names. */
  suggestions?: string[]
}

const MENU_WIDTH = 224
const MENU_MAX_HEIGHT = 240

export function SqlEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  id,
  className,
  autoFocus,
  suggestions = [],
}: SqlEditorProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const preRef = React.useRef<HTMLPreElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [completion, setCompletion] = React.useState<Completion | null>(null)
  // Set after Escape or accepting so keyup/select handlers do not reopen the menu.
  const dismissedRef = React.useRef(false)

  const allItems = React.useMemo(() => {
    const seen = new Map<string, { text: string; rank: number }>()
    const add = (item: string, rank: number) => {
      const key = item.toLowerCase()
      const existing = seen.get(key)
      if (!existing || rank < existing.rank) seen.set(key, { text: item, rank })
    }
    // Collection / field names outrank functions, which outrank keywords.
    for (const item of suggestions) add(item, 0)
    for (const item of FUNCTIONS) add(item, 1)
    for (const item of KEYWORDS) add(item, 2)
    return [...seen.values()]
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
      const context = completionContext(text, caret)
      if (!context) {
        setCompletion(null)
        return
      }
      const query = context.prefix.toLowerCase()
      const items = allItems
        .filter((entry) => entry.text.toLowerCase().startsWith(query))
        .sort(
          (a, b) =>
            a.rank - b.rank || a.text.toLowerCase().localeCompare(b.text.toLowerCase()),
        )
        .slice(0, 20)
        .map((entry) => entry.text)
      if (items.length === 0) {
        setCompletion(null)
        return
      }
      const position = caretPosition(text, caret)
      setCompletion((prev) => {
        // Keep the highlighted row when a select/click event refreshes the same
        // list (e.g. right after ArrowUp/ArrowDown); reset it when the prefix
        // or matches change.
        const same =
          prev !== null &&
          prev.prefix === context.prefix &&
          prev.items.length === items.length &&
          prev.items.every((item, i) => item === items[i])
        return {
          items,
          index: same && prev ? Math.min(prev.index, items.length - 1) : 0,
          start: context.start,
          prefix: context.prefix,
          ...position,
        }
      })
    },
    [allItems, caretPosition],
  )

  const accept = React.useCallback(
    (item: string) => {
      const textarea = textareaRef.current
      if (!textarea || !completion) return
      const caret = textarea.selectionStart ?? value.length
      const start = caret - completion.prefix.length
      const next = value.slice(0, start) + item + value.slice(caret)
      onChange(next)
      const pos = start + item.length
      dismissedRef.current = true
      setCompletion(null)
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(pos, pos)
        syncScroll()
      })
    },
    [completion, value, onChange, syncScroll],
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
        accept(completion.items[completion.index])
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

  const html = React.useMemo(() => highlightSql(value) + "\n", [value])

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring/50 relative h-40 min-h-[7rem] max-h-[18rem] resize-y overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
          className,
        )}
      >
        <pre
          ref={preRef}
          aria-hidden="true"
          className="scrollbar-thin pointer-events-none absolute inset-0 m-0 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre"
        >
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={textareaRef}
          id={id}
          data-testid="sql-editor"
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
          className="scrollbar-thin caret-foreground placeholder:text-muted-foreground selection:bg-primary/30 relative block h-full w-full resize-none overflow-auto bg-transparent p-3 font-mono text-xs leading-relaxed whitespace-pre text-transparent outline-none"
        />
      </div>

      {completion
        ? createPortal(
            <div
              data-testid="sql-completion"
              role="listbox"
              style={{ top: completion.top, left: completion.left, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
              className="bg-popover text-popover-foreground fixed z-50 overflow-auto rounded-md border p-1 shadow-md"
            >
              {completion.items.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={index === completion.index}
                  data-testid="sql-completion-item"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    accept(item)
                  }}
                  onMouseEnter={() => setCompletion((c) => (c ? { ...c, index } : c))}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left font-mono text-xs",
                    index === completion.index
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
