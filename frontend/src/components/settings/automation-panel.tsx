import * as React from "react"
import { Loader2, Pencil, Play, Plus, Save, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/settings/panel"
import { JsonEditor } from "@/components/json-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type {
  AlertRule,
  AlertRuntimeState,
  Connection,
  RunbookRule,
  RunbookRuntimeState,
  SMTPSettings,
} from "@/lib/types"

type Tab = "alerts" | "runbooks" | "smtp"

function blankAlert(): AlertRule {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    connectionId: "",
    database: "",
    collection: "",
    filter: "{}",
    metric: "count",
    pipeline: "",
    valueField: "",
    operator: "above",
    threshold: 0,
    intervalSeconds: 60,
    cooldownSeconds: 300,
    webhookUrl: "",
    webhookSecret: "",
    emailTo: "",
    enabled: true,
  }
}

function blankRunbook(): RunbookRule {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    connectionId: "",
    database: "",
    script: "",
    intervalSeconds: 3600,
    timeoutSeconds: 60,
    enabled: true,
  }
}

function useConnections() {
  const [connections, setConnections] = React.useState<Connection[]>([])
  React.useEffect(() => {
    void api.listConnections().then(setConnections).catch(() => undefined)
  }, [])
  return connections
}

function DatabaseFields({
  connectionId,
  database,
  collection,
  onConnection,
  onDatabase,
  onCollection,
}: {
  connectionId: string
  database: string
  collection?: string
  onConnection: (value: string) => void
  onDatabase: (value: string) => void
  onCollection?: (value: string) => void
}) {
  const { t } = useI18n()
  const connections = useConnections()
  const [databases, setDatabases] = React.useState<string[]>([])
  const [collections, setCollections] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!connectionId) {
      setDatabases([])
      return
    }
    void api
      .listDatabases(connectionId)
      .then((res) => setDatabases(res.databases.map((db) => db.name)))
      .catch(() => setDatabases([]))
  }, [connectionId])

  React.useEffect(() => {
    if (!connectionId || !database) {
      setCollections([])
      return
    }
    void api
      .listCollections(connectionId, database)
      .then((res) => setCollections(res.map((item) => item.name)))
      .catch(() => setCollections([]))
  }, [connectionId, database])

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">{t("automation.connection")}</Label>
        <Select value={connectionId || undefined} onValueChange={onConnection}>
          <SelectTrigger size="sm"><SelectValue placeholder={t("automation.pick")} /></SelectTrigger>
          <SelectContent>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">{t("automation.database")}</Label>
        <Select value={database || undefined} onValueChange={onDatabase}>
          <SelectTrigger size="sm"><SelectValue placeholder={t("automation.pick")} /></SelectTrigger>
          <SelectContent>
            {databases.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {onCollection ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("automation.collection")}</Label>
          <Select value={collection || undefined} onValueChange={onCollection}>
            <SelectTrigger size="sm"><SelectValue placeholder={t("automation.pick")} /></SelectTrigger>
            <SelectContent>
              {collections.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}

function AlertsTab() {
  const { t } = useI18n()
  const [rules, setRules] = React.useState<AlertRule[]>([])
  const [statuses, setStatuses] = React.useState<Record<string, AlertRuntimeState>>({})
  const [draft, setDraft] = React.useState<AlertRule | null>(null)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const result = await api.getAlerts()
      setRules(result.rules ?? [])
      setStatuses(result.statuses ?? {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("automation.loadFailed"))
    }
  }, [t])

  React.useEffect(() => { void load() }, [load])

  const save = async (rule: AlertRule) => {
    setSaving(true)
    try {
      const next = rules.some((item) => item.id === rule.id)
        ? rules.map((item) => (item.id === rule.id ? rule : item))
        : [...rules, rule]
      const result = await api.saveAlerts(next)
      setRules(result.rules ?? next)
      setStatuses(result.statuses ?? {})
      setDraft(null)
      toast.success(t("automation.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("automation.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("automation.alerts")}</p>
        <Button size="sm" onClick={() => setDraft(blankAlert())}>
          <Plus /> {t("automation.addAlert")}
        </Button>
      </div>

      {draft ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
              <span className="text-xs">{t("automation.enabled")}</span>
            </div>
          </div>
          <DatabaseFields
            connectionId={draft.connectionId}
            database={draft.database}
            collection={draft.collection}
            onConnection={(connectionId) => setDraft({ ...draft, connectionId, database: "", collection: "" })}
            onDatabase={(database) => setDraft({ ...draft, database, collection: "" })}
            onCollection={(collection) => setDraft({ ...draft, collection })}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.metric")}</Label>
              <Select value={draft.metric} onValueChange={(value) => setDraft({ ...draft, metric: value as AlertRule["metric"] })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">{t("automation.metric.count")}</SelectItem>
                  <SelectItem value="value">{t("automation.metric.value")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.operator")}</Label>
              <Select value={draft.operator} onValueChange={(value) => setDraft({ ...draft, operator: value as AlertRule["operator"] })}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">{t("automation.above")}</SelectItem>
                  <SelectItem value="below">{t("automation.below")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.threshold")}</Label>
              <Input type="number" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("automation.filter")}</Label>
            <JsonEditor value={draft.filter} onChange={(filter) => setDraft({ ...draft, filter })} rows={3} className="min-h-[4.5rem]" />
          </div>
          {draft.metric === "value" ? (
            <div className="space-y-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("automation.pipeline")}</Label>
                <JsonEditor value={draft.pipeline ?? ""} onChange={(pipeline) => setDraft({ ...draft, pipeline })} rows={4} className="min-h-[6rem]" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("automation.valueField")}</Label>
                <Input value={draft.valueField ?? ""} onChange={(e) => setDraft({ ...draft, valueField: e.target.value })} placeholder="count" />
              </div>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.interval")}</Label>
              <Input type="number" value={draft.intervalSeconds} onChange={(e) => setDraft({ ...draft, intervalSeconds: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.cooldown")}</Label>
              <Input type="number" value={draft.cooldownSeconds} onChange={(e) => setDraft({ ...draft, cooldownSeconds: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.webhook")}</Label>
              <Input value={draft.webhookUrl ?? ""} onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })} placeholder="https://hooks.example.com/..." />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.webhookSecret")}</Label>
              <Input type="password" value={draft.webhookSecret ?? ""} onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })} placeholder={draft.hasWebhookSecret ? "••••••••" : ""} autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("automation.emailTo")}</Label>
            <Input value={draft.emailTo ?? ""} onChange={(e) => setDraft({ ...draft, emailTo: e.target.value })} placeholder="ops@example.com" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save(draft)} disabled={saving || !draft.name || !draft.collection}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void api.testAlert(draft).then(() => toast.success(t("automation.testSent"))).catch((err) => toast.error(err instanceof Error ? err.message : t("automation.testFailed")))}>
              <Send /> {t("automation.test")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : null}

      <div className="divide-y rounded-lg border">
        {rules.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">{t("automation.noAlerts")}</p>
        ) : (
          rules.map((rule) => {
            const status = statuses[rule.id]
            return (
              <div key={rule.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {rule.name}
                    {status?.triggered ? <Badge variant="destructive">{t("chart.alert")}</Badge> : null}
                    {!rule.enabled ? <Badge variant="secondary">{t("automation.disabled")}</Badge> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {rule.database}.{rule.collection} · {rule.metric} {rule.operator} {rule.threshold} · {rule.intervalSeconds}s
                    {status?.lastValue ? ` · ${t("automation.lastValue", { value: status.lastValue })}` : ""}
                    {status?.lastError ? ` · ${status.lastError}` : ""}
                  </p>
                </div>
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => void save({ ...rule, enabled })} />
                <Button variant="ghost" size="icon-sm" onClick={() => setDraft({ ...rule, webhookSecret: "" })} aria-label={t("common.edit")}><Pencil /></Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    void api
                      .saveAlerts(rules.filter((item) => item.id !== rule.id))
                      .then((result) => {
                        setRules(result.rules)
                        setStatuses(result.statuses)
                      })
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : t("automation.saveFailed")),
                      )
                  }
                  aria-label={t("common.delete")}
                >
                  <Trash2 />
                </Button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function RunbooksTab() {
  const { t } = useI18n()
  const [runbooks, setRunbooks] = React.useState<RunbookRule[]>([])
  const [statuses, setStatuses] = React.useState<Record<string, RunbookRuntimeState>>({})
  const [draft, setDraft] = React.useState<RunbookRule | null>(null)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const result = await api.getRunbooks()
      setRunbooks(result.runbooks ?? [])
      setStatuses(result.statuses ?? {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("automation.loadFailed"))
    }
  }, [t])

  React.useEffect(() => { void load() }, [load])

  const save = async (runbook: RunbookRule) => {
    setSaving(true)
    try {
      const next = runbooks.some((item) => item.id === runbook.id)
        ? runbooks.map((item) => (item.id === runbook.id ? runbook : item))
        : [...runbooks, runbook]
      const result = await api.saveRunbooks(next)
      setRunbooks(result.runbooks ?? next)
      setStatuses(result.statuses ?? {})
      setDraft(null)
      toast.success(t("automation.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("automation.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("automation.runbooks")}</p>
        <Button size="sm" onClick={() => setDraft(blankRunbook())}><Plus /> {t("automation.addRunbook")}</Button>
      </div>
      {draft ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
              <span className="text-xs">{t("automation.enabled")}</span>
            </div>
          </div>
          <DatabaseFields
            connectionId={draft.connectionId}
            database={draft.database}
            onConnection={(connectionId) => setDraft({ ...draft, connectionId, database: "" })}
            onDatabase={(database) => setDraft({ ...draft, database })}
          />
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("automation.script")}</Label>
            <Textarea value={draft.script} onChange={(e) => setDraft({ ...draft, script: e.target.value })} rows={5} className="font-mono text-xs" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.interval")}</Label>
              <Input type="number" value={draft.intervalSeconds} onChange={(e) => setDraft({ ...draft, intervalSeconds: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("automation.timeout")}</Label>
              <Input type="number" value={draft.timeoutSeconds} onChange={(e) => setDraft({ ...draft, timeoutSeconds: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save(draft)} disabled={saving || !draft.name || !draft.database || !draft.script}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : null}
      <div className="divide-y rounded-lg border">
        {runbooks.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">{t("automation.noRunbooks")}</p>
        ) : (
          runbooks.map((runbook) => {
            const status = statuses[runbook.id]
            return (
              <div key={runbook.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {runbook.name}
                    {!runbook.enabled ? <Badge variant="secondary">{t("automation.disabled")}</Badge> : null}
                    {status?.lastStatus === "error" ? <Badge variant="destructive">{t("automation.failed")}</Badge> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {runbook.database} · {runbook.intervalSeconds}s
                    {status?.lastRun ? ` · ${status.lastRun}` : ""}
                    {status?.lastError ? ` · ${status.lastError}` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void api.runRunbook(runbook.id).then(() => toast.success(t("automation.started"))).catch((err) => toast.error(err instanceof Error ? err.message : t("automation.runFailed")))}>
                  <Play /> {t("common.run")}
                </Button>
                <Switch checked={runbook.enabled} onCheckedChange={(enabled) => void save({ ...runbook, enabled })} />
                <Button variant="ghost" size="icon-sm" onClick={() => setDraft({ ...runbook })} aria-label={t("common.edit")}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => void api.saveRunbooks(runbooks.filter((item) => item.id !== runbook.id)).then((result) => { setRunbooks(result.runbooks); setStatuses(result.statuses) }).catch(() => undefined)} aria-label={t("common.delete")}><Trash2 /></Button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function SMTPTab() {
  const { t } = useI18n()
  const [cfg, setCfg] = React.useState<SMTPSettings | null>(null)
  const [password, setPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void api.getSMTP().then(setCfg).catch(() => toast.error(t("automation.loadFailed")))
  }, [t])

  if (!cfg) return <p className="text-muted-foreground text-xs">{t("common.loading")}</p>

  const save = async () => {
    setSaving(true)
    try {
      setCfg(await api.saveSMTP({ ...cfg, password }))
      setPassword("")
      toast.success(t("automation.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("automation.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => setCfg({ ...cfg, enabled })} />
        {t("automation.smtpEnabled")}
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("automation.smtpHost")}</Label>
          <Input value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} placeholder="smtp.example.com" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("automation.smtpPort")}</Label>
          <Input type="number" value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("automation.smtpUser")}</Label>
          <Input value={cfg.username} onChange={(e) => setCfg({ ...cfg, username: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("automation.smtpPassword")}</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg.hasPassword ? "••••••••" : ""} autoComplete="off" />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label className="text-xs">{t("automation.smtpFrom")}</Label>
          <Input value={cfg.from} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} placeholder="MongoUI <alerts@example.com>" />
        </div>
      </div>
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
      </Button>
    </div>
  )
}

/** Admin panel for server-side alerts, scheduled runbooks and SMTP delivery. */
export function AutomationPanel() {
  const { t } = useI18n()
  const [tab, setTab] = React.useState<Tab>("alerts")
  return (
    <Panel title={t("automation.title")} description={t("automation.desc")}>
      <div className="flex items-center gap-1 rounded-md border p-0.5">
        {(["alerts", "runbooks", "smtp"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={tab === item ? "bg-accent text-accent-foreground rounded px-2 py-1 text-xs font-medium" : "text-muted-foreground hover:text-foreground rounded px-2 py-1 text-xs"}
          >
            {t(`automation.tab.${item}`)}
          </button>
        ))}
      </div>
      {tab === "alerts" ? <AlertsTab /> : tab === "runbooks" ? <RunbooksTab /> : <SMTPTab />}
    </Panel>
  )
}
