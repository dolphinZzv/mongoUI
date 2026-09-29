import * as React from "react"
import { BotIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
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
      </PopoverContent>
    </Popover>
  )
}
