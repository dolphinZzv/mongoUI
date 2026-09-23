/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` is only available in a secure context (HTTPS or
 * localhost). When the app is served over plain HTTP on a LAN address we fall
 * back to `document.execCommand("copy")`.
 *
 * The fallback selects the text through a DOM Range on an off-screen element
 * rather than focusing a <textarea>: Radix menus trap focus while open, so a
 * focused textarea would be blurred immediately and the copy would be empty.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy implementation.
    }
  }
  return execCopy(text)
}

function execCopy(text: string): boolean {
  if (typeof document === "undefined") return false

  const container = document.createElement("div")
  container.textContent = text
  container.setAttribute("aria-hidden", "true")
  // Keep the text selectable but out of view.
  container.style.position = "fixed"
  container.style.top = "0"
  container.style.left = "-9999px"
  container.style.whiteSpace = "pre"
  container.style.userSelect = "text"
  document.body.appendChild(container)

  const selection = document.getSelection()
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  let ok = false
  try {
    const range = document.createRange()
    range.selectNodeContents(container)
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.body.removeChild(container)
    if (previousRange && selection) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
  }
  return ok
}
