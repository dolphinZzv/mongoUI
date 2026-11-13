import * as React from "react"
import {
  BotIcon,
  CheckIcon,
  Clock,
  DatabaseBackup,
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
  ShieldOff,
  Sparkles,
  SunIcon,
  Tag,
  Workflow,
  Ticket,
  UserRound,
  Users,
} from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import { AISettingsPanel } from "@/components/settings/ai-settings-panel"
import { AutomationPanel } from "@/components/settings/automation-panel"
import { Panel } from "@/components/settings/panel"
import { MCPSettingsPanel } from "@/components/settings/mcp-panel"
import { UpdatesPanel } from "@/components/settings/updates-panel"
import { ActionRow, SettingRow } from "@/components/settings/rows"
import { useAuth } from "@/components/auth-gate"
import { refreshTeamAliases, setAliasMode, useAliasStore } from "@/lib/aliases"
import { LazyMount } from "@/components/lazy-mount"
import { api } from "@/lib/api"
import { LOCALES, useI18n } from "@/lib/i18n"
import {
  LOCAL_TIME_ZONE,
  UTC_TIME_ZONE,
  supportedTimeZones,
  useDateTimeZone,
  writeDateTimeZone,
} from "@/lib/dateTime"
import { useTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { agentToolList, setAgentEnabled, useAgentEnabled, webMcpAvailable } from "@/lib/webmcp"

const UsersDialog = React.lazy(() =>
  import("@/components/users-dialog").then((m) => ({ default: m.UsersDialog })),
)
const BackupsDialog = React.lazy(() =>
  import("@/components/backups-dialog").then((m) => ({ default: m.BackupsDialog })),
)
const AIProposalsDialog = React.lazy(() =>
  import("@/components/ai-proposals-dialog").then((m) => ({ default: m.AIProposalsDialog })),
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
  | "automation"
  | "admin"
  | "feedback"

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
  const [aiProposalsOpen, setAiProposalsOpen] = React.useState(false)
  const [oidcOpen, setOidcOpen] = React.useState(false)
  const [tokensOpen, setTokensOpen] = React.useState(false)
  const [passwordOpen, setPasswordOpen] = React.useState(false)
  const aliasStore = useAliasStore()
  const agentEnabled = useAgentEnabled()
  const agentTools = React.useMemo(() => agentToolList(), [])
  const timeZones = React.useMemo(() => supportedTimeZones(), [])
  const dateTimeZone = useDateTimeZone()
  const webmcp = React.useMemo(() => webMcpAvailable(), [])

  const isAdmin = !authEnabled || role === "admin"
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
        { id: "automation", label: t("settings.section.automation"), icon: <Workflow /> },
      )
    }
    if (isAdmin) {
      items.push({ id: "admin", label: t("settings.section.admin"), icon: <ShieldCheck /> })
    }
    items.push({ id: "feedback", label: t("settings.section.feedback"), icon: <MessageSquare /> })
    return items
  }, [authEnabled, username, isAdmin, role, t])

  React.useEffect(() => {
    if (sections.some((item) => item.id === section)) return
    setSection(sections[0]?.id ?? "appearance")
  }, [sections, section])

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
                      icon={<ShieldOff />}
                      title={t("auth.signOutAll")}
                      description={t("settings.signOutAllDesc")}
                      destructive
                      onClick={() => {
                        setOpen(false)
                        void api.authLogout(true).then(() => window.location.reload())
                      }}
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

                  <div className="grid gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="size-4" /> {t("settings.dateTimeZone")}
                    </p>
                    <Select value={dateTimeZone} onValueChange={writeDateTimeZone}>
                      <SelectTrigger className="w-full sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value={LOCAL_TIME_ZONE}>{t("dateTime.local")}</SelectItem>
                        <SelectItem value={UTC_TIME_ZONE}>{t("dateTime.utc")}</SelectItem>
                        {timeZones
                          .filter((zone) => zone !== "UTC")
                          .map((zone) => (
                            <SelectItem key={zone} value={zone}>
                              {zone}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      {t("settings.dateTimeZoneHint")}
                    </p>
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

              {section === "mcp" && isAdmin ? <MCPSettingsPanel /> : null}

              {section === "updates" && isAdmin ? <UpdatesPanel /> : null}

              {section === "ai" ? <AISettingsPanel /> : null}

              {section === "automation" && isAdmin ? <AutomationPanel /> : null}

              {section === "admin" && isAdmin ? (
                <Panel title={t("settings.section.admin")} description={t("settings.adminDesc")}>
                  <div className="divide-y rounded-lg border">
                    {authEnabled && role === "admin" ? (
                      <>
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
                      </>
                    ) : null}
                    <ActionRow
                      icon={<ShieldCheck />}
                      title={t("aiApprovals.title")}
                      description={t("settings.aiApprovalsDesc")}
                      onClick={() => launch(setAiProposalsOpen)}
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
      <LazyMount active={aiProposalsOpen}>
        <AIProposalsDialog open={aiProposalsOpen} onOpenChange={setAiProposalsOpen} />
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
