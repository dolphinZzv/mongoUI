import * as React from "react"
import { BotIcon, CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { copyToClipboard } from "@/lib/clipboard"
import { agentToolList, setAgentEnabled, useAgentEnabled, webMcpAvailable } from "@/lib/webmcp"

/**
 * Header control for the in-browser agent opt-in. Off by default; enabling it
 * exposes `window.mongouiAgent` and registers the tools with WebMCP when the
 * browser supports it.
 */
export function AgentToggle({ className }: { className?: string }) {
  const enabled = useAgentEnabled()
  const tools = React.useMemo(() => agentToolList(), [])
  const mcp = React.useMemo(() => webMcpAvailable(), [])
  const [copiedMcp, setCopiedMcp] = React.useState(false)
  const mcpUrl =
    typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`

  const copyMcp = async () => {
    const ok = await copyToClipboard(mcpUrl)
    if (!ok) return
    setCopiedMcp(true)
    window.setTimeout(() => setCopiedMcp(false), 1500)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className}
          title="Browser agent access"
          aria-label={`Browser agent access: ${enabled ? "enabled" : "disabled"}`}
        >
          <BotIcon />
          <span className="hidden sm:inline">Agent</span>
          <span
            className={
              "size-1.5 rounded-full " + (enabled ? "bg-emerald-500" : "bg-muted-foreground/40")
            }
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-start justify-between gap-3 border-b p-3">
          <div className="space-y-1">
            <Label htmlFor="mongoui-agent" className="text-sm font-medium">
              Allow browser agent
            </Label>
            <p className="text-muted-foreground text-xs">
              When on, an in-browser agent (WebMCP / extension / console) can read and modify
              your data through{" "}
              <code className="bg-muted rounded px-1 py-0.5 text-[11px]">window.mongouiAgent</code>.
            </p>
          </div>
          <Switch id="mongoui-agent" checked={enabled} onCheckedChange={setAgentEnabled} />
        </div>

        <div className="text-muted-foreground space-y-2 p-3 text-xs">
          <p>
            <span className="text-foreground font-medium">WebMCP:</span>{" "}
            {mcp
              ? "available — tools are registered automatically."
              : "not available in this browser; the window fallback still works."}
          </p>
          <p>
            <span className="text-foreground font-medium">{tools.length} tools</span> exposed while
            enabled:
          </p>
          <div className="max-h-44 space-y-1 overflow-auto font-mono text-[11px] leading-tight">
            {tools.map((tool) => (
              <div key={tool.name} className="truncate" title={tool.description}>
                {tool.name}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 border-t p-3 text-xs">
          <p className="text-foreground font-medium">Server MCP</p>
          <p className="text-muted-foreground">
            External agents (Claude Desktop, Cursor, ...) can drive mongoUI over the Model
            Context Protocol:
          </p>
          <div className="flex items-center gap-1">
            <code className="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-1 text-[11px]">
              {mcpUrl}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={copyMcp}
              title="Copy MCP endpoint"
            >
              {copiedMcp ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Start the server with <code className="bg-muted rounded px-1">-mcp-readonly</code> to
            expose read tools only; the local agent can also use <code className="bg-muted rounded px-1">mongoui mcp</code> over stdio.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
