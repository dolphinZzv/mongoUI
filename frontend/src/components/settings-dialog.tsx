import * as React from "react"
import {
  BotIcon,
  CheckIcon,
  ChevronRight,
  CopyIcon,
  DatabaseBackup,
  DownloadIcon,
  KeyRound,
  Languages,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquare,
  MonitorIcon,
  MoonIcon,
  Palette,
  RefreshCw,
  Server,
  Settings2Icon,
  ShieldCheck,
  Sparkles,
  SunIcon,
  Tag,
  Ticket,
  UserRound,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/components/auth-gate"
import { refreshTeamAliases, setAliasMode, useAliasStore } from "@/lib/aliases"
import { LazyMount } from "@/components/lazy-mount"
import { api } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { LOCALES, useI18n } from "@/lib/i18n"
import { useTheme, type Theme } from "@/lib/theme"
import type {
  AIProvider,
  AISettings,
  AISettingsInput,
  OpenAIAPIMode,
  MCPSettings,
  UpdateSettings,
  UpdateState,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { agentToolList, setAgentEnabled, useAgentEnabled, webMcpAvailable } from "@/lib/webmcp"

const UsersDialog = React.lazy(() =>
  import("@/components/users-dialog").then((m) => ({ default: m.UsersDialog })),
)
const BackupsDialog = React.lazy(() =>
  import("@/components/backups-dialog").then((m) => ({ default: m.BackupsDialog })),
)
const OIDCDialog = React.lazy(() =>
  import("@/components/oidc-dialog").then((m) => ({ default: m.OIDCDialog })),
)
const TokensDialog = React.lazy(() =>
  import("@/components/tokens-dialog").then((m) => ({ default: m.TokensDialog })),
)
const PasswordDialog = React.lazy(() =>
  import("@/components/password-dialog").then((m) => ({ default: m.PasswordDialog })),
)

type SettingsSectionId =
  | "account"
  | "appearance"
  | "aliases"
  | "agent"
  | "mcp"
  | "updates"
  | "ai"
  | "admin"
  | "feedback"

interface AIFormState {
  provider: AIProvider | ""
  baseURL: string
  model: string
  apiMode: OpenAIAPIMode | ""
  adkEndpoint: string
  adkAppName: string
  adkUserID: string
}

const EMPTY_AI_FORM: AIFormState = {
  provider: "",
  baseURL: "",
  model: "",
  apiMode: "",
  adkEndpoint: "",
  adkAppName: "",
  adkUserID: "",
}

interface SettingsDialogProps {
  authEnabled: boolean
  onFeedback: () => void
}

/**
 * Grouped settings dialog. Account, appearance, integrations, server
 * administration and feedback live in separate sections instead of one long
 * dropdown menu.
 */
export function SettingsDialog({ authEnabled, onFeedback }: SettingsDialogProps) {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const { role, username, source } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [section, setSection] = React.useState<SettingsSectionId>(() =>
    authEnabled && username ? "account" : "appearance",
  )
  const [usersOpen, setUsersOpen] = React.useState(false)
  const [backupsOpen, setBackupsOpen] = React.useState(false)
  const [oidcOpen, setOidcOpen] = React.useState(false)
  const [tokensOpen, setTokensOpen] = React.useState(false)
  const [passwordOpen, setPasswordOpen] = React.useState(false)
  const aliasStore = useAliasStore()
  const agentEnabled = useAgentEnabled()
  const agentTools = React.useMemo(() => agentToolList(), [])
  const webmcp = React.useMemo(() => webMcpAvailable(), [])
  const [mcp, setMcp] = React.useState<MCPSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [update, setUpdate] = React.useState<UpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = React.useState<"check" | "install" | null>(null)
  const [ai, setAI] = React.useState<AISettings | null>(null)
  const [aiForm, setAIForm] = React.useState<AIFormState>(EMPTY_AI_FORM)
  const [aiKey, setAIKey] = React.useState("")
  const [aiToken, setAIToken] = React.useState("")
  const [clearAIKey, setClearAIKey] = React.useState(false)
  const [clearADKToken, setClearADKToken] = React.useState(false)
  const [aiBusy, setAIBusy] = React.useState(false)
  const [aiTesting, setAITesting] = React.useState(false)

  const isAdmin = !authEnabled || role === "admin"
  const mcpUrl = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`

  const refreshMCP = React.useCallback(async () => {
    try {
      setMcp(await api.mcpSettings())
    } catch {
      /* the API may be unavailable before the first render */
    }
  }, [])

  const refreshUpdate = React.useCallback(async () => {
    try {
      setUpdate(await api.getUpdate())
    } catch {
      /* the API may be unavailable before the first render */
    }
  }, [])

  const refreshAI = React.useCallback(async () => {
    try {
      const data = await api.getAISettings()
      setAI(data)
      setAIForm({
        provider: data.provider,
        baseURL: data.baseURL,
        model: data.model,
        apiMode: data.apiMode || (data.provider === "openai" ? "chat" : ""),
        adkEndpoint: data.adkEndpoint,
        adkAppName: data.adkAppName,
        adkUserID: data.adkUserID,
      })
      setAIKey("")
      setAIToken("")
      setClearAIKey(false)
      setClearADKToken(false)
    } catch {
      toast.error(t("ai.loadFailed"))
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    void refreshMCP()
    void refreshUpdate()
    void refreshAI()
  }, [open, refreshMCP, refreshUpdate, refreshAI])

  const aiInput = (): AISettingsInput => ({
    provider: aiForm.provider,
    baseURL: aiForm.baseURL,
    model: aiForm.model,
    apiMode: aiForm.apiMode,
    apiKey: aiKey.trim() || undefined,
    clearAPIKey: clearAIKey,
    adkEndpoint: aiForm.adkEndpoint,
    adkAppName: aiForm.adkAppName,
    adkUserID: aiForm.adkUserID,
    adkToken: aiToken.trim() || undefined,
    clearADKToken,
  })

  const testAI = async () => {
    if (!aiForm.provider || aiTesting) return
    setAITesting(true)
    try {
      const result = await api.testAISettings(aiInput())
      const label = result.model ? `${result.provider} / ${result.model}` : result.provider
      toast.success(t("ai.testOk", { provider: label }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.testFailed"))
    } finally {
      setAITesting(false)
    }
  }

  const saveAI = async () => {
    if (!aiForm.provider || aiBusy) return
    setAIBusy(true)
    try {
      const saved = await api.updateAISettings(aiInput())
      setAI(saved)
      setAIForm({
        provider: saved.provider,
        baseURL: saved.baseURL,
        model: saved.model,
        apiMode: saved.apiMode || (saved.provider === "openai" ? "chat" : ""),
        adkEndpoint: saved.adkEndpoint,
        adkAppName: saved.adkAppName,
        adkUserID: saved.adkUserID,
      })
      setAIKey("")
      setAIToken("")
      setClearAIKey(false)
      setClearADKToken(false)
      toast.success(t("ai.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.saveFailed"))
    } finally {
      setAIBusy(false)
    }
  }

  const sections = React.useMemo(() => {
    const items: { id: SettingsSectionId; label: string; icon: React.ReactNode }[] = []
    if (authEnabled && username) {
      items.push({ id: "account", label: t("settings.section.account"), icon: <UserRound /> })
    }
    items.push(
      { id: "appearance", label: t("settings.section.appearance"), icon: <Palette /> },
      { id: "aliases", label: t("alias.settingsTitle"), icon: <Tag /> },
      { id: "agent", label: t("settings.section.agent"), icon: <BotIcon /> },
      // AI settings are per account, so every signed-in user can manage their
      // own BYOK profile.
      { id: "ai", label: t("settings.section.ai"), icon: <Sparkles /> },
    )
    if (isAdmin) {
      items.push(
        { id: "mcp", label: t("settings.section.mcp"), icon: <Server /> },
        { id: "updates", label: t("settings.section.updates"), icon: <RefreshCw /> },
      )
    }
    if (authEnabled && role === "admin") {
      items.push({ id: "admin", label: t("settings.section.admin"), icon: <ShieldCheck /> })
    }
    items.push({ id: "feedback", label: t("settings.section.feedback"), icon: <MessageSquare /> })
    return items
  }, [authEnabled, username, isAdmin, role, t])

  React.useEffect(() => {
    if (sections.some((item) => item.id === section)) return
    setSection(sections[0]?.id ?? "appearance")
  }, [sections, section])

  const updateSettings = update?.settings ?? null

  const saveUpdateSettings = async (patch: Partial<UpdateSettings>) => {
    try {
      const settings = await api.updateUpdateSettings(patch)
      setUpdate((prev) => ({ settings, status: prev?.status ?? null }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("update.failed"))
    }
  }

  const runUpdateAction = async (action: "check" | "install") => {
    setUpdateBusy(action)
    try {
      const status = action === "install" ? await api.installUpdate() : await api.checkUpdate()
      setUpdate((prev) => (prev ? { ...prev, status } : prev))
      if (status.restartRequired) {
        toast.success(t("update.installed", { version: status.installedVersion }))
      } else if (status.updateAvailable) {
        toast.info(t("update.available"))
      } else {
        toast.success(t("update.upToDate"))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("update.failed"))
    } finally {
      setUpdateBusy(null)
    }
  }

  const updateMCP = async (patch: Partial<MCPSettings>) => {
    setSaving(true)
    try {
      setMcp(await api.updateMcpSettings(patch))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mcp.updateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const copyMCP = async () => {
    const success = await copyToClipboard(mcpUrl)
    if (!success) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const mcpEnabled = Boolean(mcp?.enabled)
  const readEnabled = Boolean(mcp?.read)
  const writeEnabled = Boolean(mcp?.write)
  const updateStatus = update?.status ?? null
  const autoUpdate = updateSettings?.auto ?? true

  const launch = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setOpen(false)
    setter(true)
  }

  const openFeedback = () => {
    setOpen(false)
    onFeedback()
  }

  const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("theme.light"), icon: <SunIcon /> },
    { value: "dark", label: t("theme.dark"), icon: <MoonIcon /> },
    { value: "system", label: t("theme.system"), icon: <MonitorIcon /> },
  ]

  const sourceLabel =
    source === "oidc"
      ? t("users.source.oidc")
      : source === "password"
        ? t("users.source.password")
        : t("users.source.totp")

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title={t("settings.title")}
        aria-label={t("settings.title")}
      >
        <Settings2Icon />
        <span className="hidden sm:inline">{t("settings.button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>{t("settings.title")}</DialogTitle>
            <DialogDescription>{t("settings.desc")}</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <div className="border-b p-3 sm:hidden">
              <Select
                value={section}
                onValueChange={(value) => setSection(value as SettingsSectionId)}
              >
                <SelectTrigger className="w-full" aria-label={t("settings.title")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <nav
              aria-label={t("settings.title")}
              className="scrollbar-thin hidden gap-1 overflow-y-auto border-r p-3 sm:flex sm:w-52 sm:shrink-0 sm:flex-col"
            >
              {sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors sm:w-full",
                    section === item.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="[&_svg]:size-4">{item.icon}</span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
              {section === "account" && authEnabled && username ? (
                <Panel title={t("settings.section.account")} description={t("settings.accountDesc")}>
                  <div className="flex items-center gap-3 rounded-lg border p-4">
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                      <UserRound className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{username}</p>
                      <p className="text-muted-foreground text-xs">
                        {sourceLabel}
                        {role ? ` · ${t(`users.role.${role}`)}` : ""}
                      </p>
                    </div>
                    {role ? <Badge variant="secondary">{t(`users.role.${role}`)}</Badge> : null}
                  </div>

                  <div className="divide-y rounded-lg border">
                    {source !== "oidc" ? (
                      <ActionRow
                        icon={<LockKeyhole />}
                        title={t("auth.changePassword")}
                        description={t("settings.passwordDesc")}
                        onClick={() => launch(setPasswordOpen)}
                      />
                    ) : null}
                    <ActionRow
                      icon={<Ticket />}
                      title={t("tokens.title")}
                      description={t("settings.tokensDesc")}
                      onClick={() => launch(setTokensOpen)}
                    />
                    <ActionRow
                      icon={<LogOut />}
                      title={t("auth.signOut")}
                      description={t("settings.signOutDesc")}
                      destructive
                      onClick={() => {
                        setOpen(false)
                        void api.authLogout().then(() => window.location.reload())
                      }}
                    />
                  </div>
                </Panel>
              ) : null}

              {section === "appearance" ? (
                <Panel
                  title={t("settings.section.appearance")}
                  description={t("settings.appearanceDesc")}
                >
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t("theme.title")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {themeOptions.map((option) => {
                        const active = theme === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setTheme(option.value)}
                            aria-pressed={active}
                            className={cn(
                              "flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors",
                              active
                                ? "border-primary bg-primary/5 text-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <span className="[&_svg]:size-5">{option.icon}</span>
                            <span>{option.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Languages className="size-4" /> {t("lang.label")}
                    </p>
                    <Select
                      value={locale}
                      onValueChange={(value) => setLocale(value as typeof locale)}
                    >
                      <SelectTrigger className="w-full sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCALES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Panel>
              ) : null}

              {section === "aliases" ? (
                <Panel
                  title={t("alias.settingsTitle")}
                  description={t("alias.settingsDesc")}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        {
                          id: "local" as const,
                          title: t("alias.modeLocal"),
                          description: t("alias.modeLocalDesc"),
                          icon: <MonitorIcon />,
                        },
                        {
                          id: "team" as const,
                          title: t("alias.modeTeam"),
                          description: t("alias.modeTeamDesc"),
                          icon: <Users />,
                        },
                      ]
                    ).map((option) => {
                      const active = aliasStore.mode === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setAliasMode(option.id)}
                          aria-pressed={active}
                          className={cn(
                            "flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
                            active
                              ? "border-primary bg-primary/5"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <span className="[&_svg]:size-4">{option.icon}</span>
                            <span className="flex-1">{option.title}</span>
                            {active ? <CheckIcon className="size-4 text-primary" /> : null}
                          </span>
                          <span className="text-xs leading-relaxed">{option.description}</span>
                        </button>
                      )
                    })}
                  </div>

                  {aliasStore.mode === "team" ? (
                    <div className="space-y-2 rounded-lg border p-4 text-sm">
                      {aliasStore.teamLoading ? (
                        <p className="text-muted-foreground flex items-center gap-2 text-xs">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t("alias.teamLoading")}
                        </p>
                      ) : aliasStore.teamError ? (
                        <>
                          <p className="text-destructive text-xs">
                            {t("alias.teamError")}: {aliasStore.teamError}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void refreshTeamAliases().catch(() => undefined)}
                          >
                            {t("common.retry")}
                          </Button>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-xs">{t("alias.teamWriteHint")}</p>
                      )}
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {section === "agent" ? (
                <Panel
                  title={t("settings.section.agent")}
                  description={t("settings.agentDesc")}
                >
                  <div className="divide-y rounded-lg border">
                    <SettingRow
                      title={t("agent.allow")}
                      description={webmcp ? t("agent.webmcpYes") : t("agent.webmcpNo")}
                      control={
                        <Switch checked={agentEnabled} onCheckedChange={setAgentEnabled} />
                      }
                    />
                  </div>
                  {agentEnabled ? (
                    <div className="space-y-2">
                      <p className="text-muted-foreground text-xs">{t("agent.toolsHint")}</p>
                      <div className="text-muted-foreground scrollbar-thin max-h-64 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed">
                        {agentTools.map((tool) => (
                          <div key={tool.name} className="truncate" title={tool.description}>
                            {tool.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {section === "mcp" && isAdmin ? (
                <Panel title={t("mcp.title")} description={t("settings.mcpDesc")}>
                  <div className="divide-y rounded-lg border">
                    <SettingRow
                      title={t("mcp.enable")}
                      description={t("mcp.enableHint")}
                      control={
                        <Switch
                          checked={mcpEnabled}
                          disabled={saving || mcp === null}
                          onCheckedChange={(checked) => void updateMCP({ enabled: checked })}
                        />
                      }
                    />
                    <SettingRow
                      title={t("mcp.read")}
                      description={t("mcp.readHint")}
                      control={
                        <Switch
                          checked={readEnabled}
                          disabled={saving || !mcpEnabled}
                          onCheckedChange={(checked) => void updateMCP({ read: checked })}
                        />
                      }
                    />
                    <SettingRow
                      title={t("mcp.write")}
                      description={t("mcp.writeHint")}
                      control={
                        <Switch
                          checked={writeEnabled}
                          disabled={saving || !mcpEnabled}
                          onCheckedChange={(checked) => void updateMCP({ write: checked })}
                        />
                      }
                    />
                  </div>
                  {mcp !== null && !mcpEnabled ? (
                    <p className="text-muted-foreground text-xs">{t("mcp.disabledHint")}</p>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs">{t("settings.mcpEndpoint")}</p>
                    <div className="flex items-center gap-2 rounded-lg border p-2">
                      <code className="min-w-0 flex-1 truncate text-xs">{mcpUrl}</code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={copyMCP}
                        title={t("common.copy")}
                        aria-label={t("common.copy")}
                      >
                        {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
                      </Button>
                    </div>
                  </div>
                </Panel>
              ) : null}

              {section === "updates" && isAdmin ? (
                <Panel title={t("update.title")} description={t("settings.updatesDesc")}>
                  <div className="divide-y rounded-lg border">
                    <SettingRow
                      title={t("update.auto")}
                      description={t("update.autoHint")}
                      control={
                        <Switch
                          checked={autoUpdate}
                          disabled={update === null}
                          onCheckedChange={(checked) =>
                            void saveUpdateSettings({ auto: checked })
                          }
                        />
                      }
                    />
                    {autoUpdate ? (
                      <SettingRow
                        title={t("update.interval")}
                        control={
                          <Select
                            value={String(updateSettings?.intervalMinutes ?? 10)}
                            onValueChange={(value) =>
                              void saveUpdateSettings({ intervalMinutes: Number(value) })
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
                      <span className="font-mono">{updateStatus?.current || "—"}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{t("update.latest")}</span>
                      <span className="font-mono">{updateStatus?.latest || "—"}</span>
                    </div>
                    {updateStatus?.restartRequired ? (
                      <p className="text-amber-600 dark:text-amber-400">
                        {t("update.installed", { version: updateStatus.installedVersion })}
                      </p>
                    ) : updateStatus?.updateAvailable ? (
                      <p className="text-amber-600 dark:text-amber-400">
                        {t("update.available")}
                      </p>
                    ) : updateStatus?.lastError ? (
                      <p className="text-destructive">
                        {t("update.error", { error: updateStatus.lastError })}
                      </p>
                    ) : updateStatus?.lastChecked ? (
                      <p className="text-emerald-600 dark:text-emerald-400">
                        {t("update.upToDate")}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updateBusy !== null || update === null}
                        onClick={() => void runUpdateAction("check")}
                      >
                        {updateBusy === "check" ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                        {t("update.check")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updateBusy !== null || !updateStatus?.updateAvailable}
                        onClick={() => void runUpdateAction("install")}
                      >
                        {updateBusy === "install" ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <DownloadIcon />
                        )}
                        {t("update.install")}
                      </Button>
                    </div>
                  </div>
                </Panel>
              ) : null}

              {section === "ai" ? (
                <Panel title={t("settings.section.ai")} description={t("ai.desc")}>
                  {ai === null ? (
                    <p className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Loader2 className="size-3.5 animate-spin" /> {t("common.loading")}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-1.5">
                        <Label>{t("ai.provider")}</Label>
                        <Select
                          value={aiForm.provider || undefined}
                          onValueChange={(value) =>
                            setAIForm((prev) => ({
                              ...prev,
                              provider: value as AIProvider,
                              baseURL: "",
                              model: "",
                              apiMode: value === "openai" ? "chat" : "",
                            }))
                          }
                        >
                          <SelectTrigger className="w-full sm:w-72">
                            <SelectValue placeholder={t("ai.provider")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">{t("ai.provider.openai")}</SelectItem>
                            <SelectItem value="gemini">{t("ai.provider.gemini")}</SelectItem>
                            <SelectItem value="adk">{t("ai.provider.adk")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {aiForm.provider === "adk" ? (
                        <>
                          <div className="grid gap-1.5">
                            <Label htmlFor="ai-adk-endpoint">{t("ai.adkEndpoint")}</Label>
                            <Input
                              id="ai-adk-endpoint"
                              value={aiForm.adkEndpoint}
                              onChange={(event) =>
                                setAIForm((prev) => ({ ...prev, adkEndpoint: event.target.value }))
                              }
                              placeholder="http://127.0.0.1:8000"
                              className="font-mono text-xs"
                            />
                            <p className="text-muted-foreground text-xs">{t("ai.adkEndpointHint")}</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                              <Label htmlFor="ai-adk-app">{t("ai.adkAppName")}</Label>
                              <Input
                                id="ai-adk-app"
                                value={aiForm.adkAppName}
                                onChange={(event) =>
                                  setAIForm((prev) => ({ ...prev, adkAppName: event.target.value }))
                                }
                                placeholder="mongoui"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor="ai-adk-user">{t("ai.adkUserID")}</Label>
                              <Input
                                id="ai-adk-user"
                                value={aiForm.adkUserID}
                                onChange={(event) =>
                                  setAIForm((prev) => ({ ...prev, adkUserID: event.target.value }))
                                }
                                placeholder="mongoui"
                              />
                            </div>
                          </div>
                          <div className="grid gap-1.5">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="ai-adk-token">{t("ai.adkToken")}</Label>
                              {ai.hasADKToken ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t("ai.keyStored")}
                                </Badge>
                              ) : null}
                            </div>
                            <Input
                              id="ai-adk-token"
                              type="password"
                              value={aiToken}
                              onChange={(event) => setAIToken(event.target.value)}
                              placeholder={ai.hasADKToken ? "••••••••" : t("ai.adkToken")}
                              autoComplete="off"
                            />
                            <p className="text-muted-foreground text-xs">{t("ai.adkTokenHint")}</p>
                            {ai.hasADKToken ? (
                              <label className="flex items-center gap-2 text-xs">
                                <Switch checked={clearADKToken} onCheckedChange={setClearADKToken} />
                                {t("ai.clearToken")}
                              </label>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid gap-1.5">
                            <Label htmlFor="ai-base-url">{t("ai.baseURL")}</Label>
                            <Input
                              id="ai-base-url"
                              value={aiForm.baseURL}
                              onChange={(event) =>
                                setAIForm((prev) => ({ ...prev, baseURL: event.target.value }))
                              }
                              placeholder={
                                aiForm.provider === "gemini"
                                  ? "https://generativelanguage.googleapis.com/v1beta"
                                  : "https://api.openai.com/v1"
                              }
                              className="font-mono text-xs"
                            />
                            <p className="text-muted-foreground text-xs">{t("ai.baseURLHint")}</p>
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="ai-model">{t("ai.model")}</Label>
                            <Input
                              id="ai-model"
                              value={aiForm.model}
                              onChange={(event) =>
                                setAIForm((prev) => ({ ...prev, model: event.target.value }))
                              }
                              placeholder={aiForm.provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"}
                              className="font-mono text-xs"
                            />
                            <p className="text-muted-foreground text-xs">{t("ai.modelHint")}</p>
                          </div>
                          {aiForm.provider === "openai" ? (
                            <div className="grid gap-1.5">
                              <Label>{t("ai.apiMode")}</Label>
                              <Select
                                value={aiForm.apiMode || "chat"}
                                onValueChange={(value) =>
                                  setAIForm((prev) => ({
                                    ...prev,
                                    apiMode: value as OpenAIAPIMode,
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full sm:w-72">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="chat">{t("ai.apiMode.chat")}</SelectItem>
                                  <SelectItem value="responses">
                                    {t("ai.apiMode.responses")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-muted-foreground text-xs">{t("ai.apiModeHint")}</p>
                            </div>
                          ) : null}

                          <div className="grid gap-1.5">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="ai-api-key">{t("ai.apiKey")}</Label>
                              {ai.hasAPIKey ? (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t("ai.keyStored")}
                                </Badge>
                              ) : null}
                            </div>
                            <Input
                              id="ai-api-key"
                              type="password"
                              value={aiKey}
                              onChange={(event) => setAIKey(event.target.value)}
                              placeholder={ai.hasAPIKey ? "••••••••" : "sk-..."}
                              autoComplete="off"
                            />
                            <p className="text-muted-foreground text-xs">{t("ai.apiKeyHint")}</p>
                            {ai.hasAPIKey ? (
                              <label className="flex items-center gap-2 text-xs">
                                <Switch checked={clearAIKey} onCheckedChange={setClearAIKey} />
                                {t("ai.clearKey")}
                              </label>
                            ) : null}
                          </div>
                        </>
                      )}

                      <p className="text-muted-foreground rounded-lg border p-3 text-xs leading-relaxed">
                        {t("ai.note")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={() => void saveAI()} disabled={aiBusy || !aiForm.provider}>
                          {aiBusy ? <Loader2 className="animate-spin" /> : null}
                          {t("ai.save")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void testAI()}
                          disabled={aiTesting || aiBusy || !aiForm.provider}
                        >
                          {aiTesting ? <Loader2 className="animate-spin" /> : null}
                          {aiTesting ? t("ai.testing") : t("ai.test")}
                        </Button>
                      </div>
                    </div>
                  )}
                </Panel>
              ) : null}

              {section === "admin" && authEnabled && role === "admin" ? (
                <Panel title={t("settings.section.admin")} description={t("settings.adminDesc")}>
                  <div className="divide-y rounded-lg border">
                    <ActionRow
                      icon={<Users />}
                      title={t("users.title")}
                      description={t("settings.usersDesc")}
                      onClick={() => launch(setUsersOpen)}
                    />
                    <ActionRow
                      icon={<DatabaseBackup />}
                      title={t("backups.title")}
                      description={t("settings.backupsDesc")}
                      onClick={() => launch(setBackupsOpen)}
                    />
                    <ActionRow
                      icon={<KeyRound />}
                      title={t("oidc.title")}
                      description={t("settings.oidcDesc")}
                      onClick={() => launch(setOidcOpen)}
                    />
                  </div>
                </Panel>
              ) : null}

              {section === "feedback" ? (
                <Panel
                  title={t("settings.section.feedback")}
                  description={t("settings.feedbackDesc")}
                >
                  <div className="space-y-3 rounded-lg border p-4">
                    <p className="text-muted-foreground text-sm">{t("feedback.contextHint")}</p>
                    <Button onClick={openFeedback}>
                      <MessageSquare /> {t("feedback.button")}
                    </Button>
                  </div>
                </Panel>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <LazyMount active={usersOpen}>
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} />
      </LazyMount>
      <LazyMount active={backupsOpen}>
        <BackupsDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
      </LazyMount>
      <LazyMount active={oidcOpen}>
        <OIDCDialog open={oidcOpen} onOpenChange={setOidcOpen} />
      </LazyMount>
      <LazyMount active={tokensOpen}>
        <TokensDialog open={tokensOpen} onOpenChange={setTokensOpen} />
      </LazyMount>
      <LazyMount active={passwordOpen}>
        <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      </LazyMount>
    </>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string
  description?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function ActionRow({
  icon,
  title,
  description,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        destructive && "text-destructive",
      )}
    >
      <span className="text-muted-foreground shrink-0 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground block text-xs">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  )
}
