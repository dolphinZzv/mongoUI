import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/settings/panel"
import { SettingRow } from "@/components/settings/rows"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import type { MCPSettings } from "@/lib/types"

/** Server MCP toggles plus the endpoint users can paste into an MCP client. */
export function MCPSettingsPanel() {
  const { t } = useI18n()
  const [mcp, setMcp] = React.useState<MCPSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const mcpUrl = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`

  React.useEffect(() => {
    let cancelled = false
    void api
      .mcpSettings()
      .then((settings) => {
        if (!cancelled) setMcp(settings)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const update = async (patch: Partial<MCPSettings>) => {
    setSaving(true)
    try {
      setMcp(await api.updateMcpSettings(patch))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mcp.updateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    if (!(await copyToClipboard(mcpUrl))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const enabled = Boolean(mcp?.enabled)

  return (
    <Panel title={t("mcp.title")} description={t("settings.mcpDesc")}>
      <div className="divide-y rounded-lg border">
        <SettingRow
          title={t("mcp.enable")}
          description={t("mcp.enableHint")}
          control={
            <Switch
              checked={enabled}
              disabled={saving || mcp === null}
              onCheckedChange={(checked) => void update({ enabled: checked })}
            />
          }
        />
        <SettingRow
          title={t("mcp.read")}
          description={t("mcp.readHint")}
          control={
            <Switch
              checked={Boolean(mcp?.read)}
              disabled={saving || !enabled}
              onCheckedChange={(checked) => void update({ read: checked })}
            />
          }
        />
        <SettingRow
          title={t("mcp.write")}
          description={t("mcp.writeHint")}
          control={
            <Switch
              checked={Boolean(mcp?.write)}
              disabled={saving || !enabled}
              onCheckedChange={(checked) => void update({ write: checked })}
            />
          }
        />
      </div>
      {mcp !== null && !enabled ? (
        <p className="text-muted-foreground text-xs">{t("mcp.disabledHint")}</p>
      ) : null}
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">{t("settings.mcpEndpoint")}</p>
        <div className="flex items-center gap-2 rounded-lg border p-2">
          <code className="min-w-0 flex-1 truncate text-xs">{mcpUrl}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void copy()}
            title={t("common.copy")}
            aria-label={t("common.copy")}
          >
            {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
