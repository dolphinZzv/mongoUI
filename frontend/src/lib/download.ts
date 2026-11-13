/** Triggers a client-side file download from an in-memory string. */
export function downloadText(filename: string, content: string, contentType = "text/plain") {
  downloadBlob(filename, new Blob([content], { type: contentType }))
}

/** Triggers a client-side download from an already-fetched Blob. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
