import { useEffect } from "react"

import { installAgentTools, useAgentEnabled } from "@/lib/webmcp"

/**
 * Registers mongoUI's agent tools only while the user has explicitly enabled
 * "allow browser agent" (off by default). Turning the switch off removes
 * `window.mongouiAgent` and unregisters the WebMCP tools immediately.
 */
export function useAgentTools() {
  const enabled = useAgentEnabled()
  useEffect(() => {
    if (!enabled) return
    return installAgentTools()
  }, [enabled])
}
