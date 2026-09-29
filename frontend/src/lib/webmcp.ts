import { useEffect, useState } from "react"

import { agentTools, callAgentTool } from "@/lib/agentTools"

/**
 * Bridges mongoUI's agent tools to the in-browser agent APIs.
 *
 * - WebMCP (`navigator.modelContext`, experimental; the API is still moving) is
 *   used when the browser exposes it, so an in-browser agent can drive the
 *   server directly.
 * - `window.mongouiAgent` is always exposed once enabled, as a stable escape
 *   hatch for extensions, bookmarklets, the console and agents without WebMCP.
 *
 * Tools are OFF by default: a user must explicitly allow a browser agent before
 * anything is registered. Turning the switch off unregisters immediately.
 */

interface McTool {
  name: string
  description: string
  inputSchema: unknown
  execute: (args: Record<string, unknown>) => unknown
}

interface ModelContext {
  registerTool?: (tool: McTool) => void
  unregisterTool?: (name: string) => void
  provideContext?: (ctx: { tools: McTool[] }) => void
}

declare global {
  interface Window {
    mongouiAgent?: {
      version: string
      tools: { name: string; description: string }[]
      call: (name: string, args?: Record<string, unknown>) => Promise<unknown>
    }
  }
}

/** True when the browser exposes a (experimental) WebMCP model context. */
export function webMcpAvailable(): boolean {
  const nav = navigator as unknown as {
    modelContext?: ModelContext
    modelContextTesting?: ModelContext
  }
  return !!(nav.modelContext || nav.modelContextTesting)
}

// --- opt-in gate ------------------------------------------------------------

const PREF_KEY = "mongoui-agent-enabled"
let agentEnabled = readPref()
const prefListeners = new Set<(v: boolean) => void>()

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1"
  } catch {
    return false
  }
}

export function isAgentEnabled(): boolean {
  return agentEnabled
}

export function setAgentEnabled(value: boolean): void {
  if (agentEnabled === value) return
  agentEnabled = value
  try {
    if (value) localStorage.setItem(PREF_KEY, "1")
    else localStorage.removeItem(PREF_KEY)
  } catch {
    /* storage may be unavailable */
  }
  for (const listener of prefListeners) listener(value)
}

/** Reactive boolean for the opt-in switch. */
export function useAgentEnabled(): boolean {
  const [value, setValue] = useState(agentEnabled)
  useEffect(() => {
    prefListeners.add(setValue)
    setValue(agentEnabled)
    return () => {
      prefListeners.delete(setValue)
    }
  }, [])
  return value
}

/** The tools exposed to agents, for display in the UI. */
export function agentToolList(): { name: string; description: string }[] {
  return agentTools.map((t) => ({ name: t.name, description: t.description }))
}

export function installAgentTools(): () => void {
  window.mongouiAgent = {
    version: "1",
    tools: agentToolList(),
    call: (name, args) => callAgentTool(name, args),
  }

  const nav = navigator as unknown as {
    modelContext?: ModelContext
    modelContextTesting?: ModelContext
  }
  const mc = nav.modelContext ?? nav.modelContextTesting
  const disposers: (() => void)[] = []

  if (mc) {
    const tools: McTool[] = agentTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      execute: (args) => callAgentTool(t.name, args ?? {}),
    }))
    try {
      if (typeof mc.registerTool === "function") {
        for (const tool of tools) {
          mc.registerTool(tool)
          disposers.push(() => mc.unregisterTool?.(tool.name))
        }
      } else if (typeof mc.provideContext === "function") {
        mc.provideContext({ tools })
        disposers.push(() => mc.provideContext?.({ tools: [] }))
      }
    } catch {
      /* experimental API: never break the UI if registration fails */
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    try {
      delete window.mongouiAgent
    } catch {
      /* ignore */
    }
  }
}
