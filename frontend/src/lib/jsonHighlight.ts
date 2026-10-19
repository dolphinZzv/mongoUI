/**
 * Tiny JSON syntax highlighter shared by the JSON editor, the read-only JSON
 * view and the mongosh result console.
 *
 * It is intentionally a hand-rolled scanner rather than a dependency: the app
 * already ships a hand-written Mongo filter/SQL highlighter, and the grammar we
 * need (keys, strings, numbers, literals, punctuation) is small enough that a
 * tokenizer would be more code than the thing it replaces.
 */

export const JSON_CLS = {
  key: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  literal: "text-violet-600 dark:text-violet-400",
  punct: "text-muted-foreground",
} as const

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Renders JSON to highlighted HTML (keys, strings, numbers, literals). */
export function highlightJson(input: string): string {
  const out: string[] = []
  const n = input.length
  let i = 0
  const push = (text: string, cls: string) => {
    out.push(cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text))
  }

  while (i < n) {
    const c = input[i]

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
      let k = j
      while (k < n && /\s/.test(input[k])) k++
      push(input.slice(i, j), input[k] === ":" ? JSON_CLS.key : JSON_CLS.string)
      i = j
      continue
    }

    if ((c >= "0" && c <= "9") || (c === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1
      while (j < n && /[0-9eE+\-.]/.test(input[j])) j++
      push(input.slice(i, j), JSON_CLS.number)
      i = j
      continue
    }

    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z]/.test(input[j])) j++
      push(input.slice(i, j), JSON_CLS.literal)
      i = j
      continue
    }

    if ("{}[],:".includes(c)) {
      push(c, JSON_CLS.punct)
      i++
      continue
    }

    let j = i
    while (j < n && !/["\dA-Za-z{}[\],:-]/.test(input[j])) j++
    push(input.slice(i, j), "")
    i = j
  }
  return out.join("")
}
