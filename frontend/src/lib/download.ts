/** Triggers a client-side file download from an in-memory string. */
export function downloadText(filename: string, content: string, contentType = "text/plain") {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a tick to start the download before revoking the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
