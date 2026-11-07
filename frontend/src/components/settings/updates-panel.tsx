import * as React from "react"
import { DownloadIcon, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/settings/panel"
import { SettingRow } from "@/components/settings/rows"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { UpdateSettings, UpdateState } from "@/lib/types"

/** Automatic-update policy and the manual check/install actions. */
export function UpdatesPanel() {
  const { t } = useI18n()
  const [update, setUpdate] = React.useState<UpdateState | null>(null)
  const [busy, setBusy] = React.useState<"check" | "install" | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void api
      .getUpdate()
      .then((state) => {
        if (!cancelled) setUpdate(state)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const settings = update?.settings ?? null
  const status = update?.status ?? null
  const autoUpdate = settings?.auto ?? true

  const saveSettings = async (patch: Partial<UpdateSettings>) => {
    try {
      const next = await api.updateUpdateSettings(patch)
      setUpdate((prev) => ({ settings: next, status: prev?.status ?? null }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("update.failed"))
    }
  }

  const run = async (action: "check" | "install") => {
    setBusy(action)
    try {
      const next = action === "install" ? await api.installUpdate() : await api.checkUpdate()
      setUpdate((prev) => (prev ? { ...prev, status: next } : prev))
      if (next.restartRequired) {
        toast.success(t("update.installed", { version: next.installedVersion }))
      } else if (next.updateAvailable) {
        toast.info(t("update.available"))
      } else {
        toast.success(t("update.upToDate"))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("update.failed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title={t("update.title")} description={t("settings.updatesDesc")}>
      <div className="divide-y rounded-lg border">
        <SettingRow
          title={t("update.auto")}
          description={t("update.autoHint")}
          control={
            <Switch
              checked={autoUpdate}
              disabled={update === null}
              onCheckedChange={(checked) => void saveSettings({ auto: checked })}
            />
          }
        />
        {autoUpdate ? (
          <SettingRow
            title={t("update.interval")}
            control={
              <Select
                value={String(settings?.intervalMinutes ?? 10)}
                onValueChange={(value) =>
                  void saveSettings({ intervalMinutes: Number(value) })
                }
              >
                <SelectTrigger size="sm" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 30, 60].map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("update.current")}</span>
          <span className="font-mono">{status?.current || "—"}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{t("update.latest")}</span>
          <span className="font-mono">{status?.latest || "—"}</span>
        </div>
        {status?.restartRequired ? (
          <p className="text-amber-600 dark:text-amber-400">
            {t("update.installed", { version: status.installedVersion })}
          </p>
        ) : status?.updateAvailable ? (
          <p className="text-amber-600 dark:text-amber-400">{t("update.available")}</p>
        ) : status?.lastError ? (
          <p className="text-destructive">{t("update.error", { error: status.lastError })}</p>
        ) : status?.lastChecked ? (
          <p className="text-emerald-600 dark:text-emerald-400">{t("update.upToDate")}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || update === null}
            onClick={() => void run("check")}
          >
            {busy === "check" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("update.check")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !status?.updateAvailable}
            onClick={() => void run("install")}
          >
            {busy === "install" ? <Loader2 className="animate-spin" /> : <DownloadIcon />}
            {t("update.install")}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
