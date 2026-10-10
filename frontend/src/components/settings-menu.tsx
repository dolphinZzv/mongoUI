import * as React from "react"
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  Languages,
  LogOut,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { LOCALES, useI18n } from "@/lib/i18n"
import { useTheme, type Theme } from "@/lib/theme"
import type { MCPSettings } from "@/lib/types"
import { agentToolList, setAgentEnabled, useAgentEnabled, webMcpAvailable } from "@/lib/webmcp"

interface SettingsMenuProps {
  authEnabled: boolean
}

/**
 * Single header dropdown that gathers the browser agent opt-in, the server MCP
 * switches (master switch + read/write tool groups), the language and theme
 * pickers, and (when TOTP is on) sign-out.
 */
export function SettingsMenu({ authEnabled }: SettingsMenuProps) {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const agentEnabled = useAgentEnabled()
  const agentTools = React.useMemo(() => agentToolList(), [])
  const webmcp = React.useMemo(() => webMcpAvailable(), [])
  const [mcp, setMcp] = React.useState<MCPSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const mcpUrl = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`

  const refreshMCP = React.useCallback(async () => {
    try {
      setMcp(await api.mcpSettings())
    } catch {
      /* the API may be unavailable before the first render */
    }
  }, [])

  React.useEffect(() => {
    void refreshMCP()
  }, [refreshMCP])

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

  const languageOptions = React.useMemo(
    () => LOCALES.map((option) => ({ ...option })),
    [],
  )
  const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("theme.light"), icon: <SunIcon /> },
    { value: "dark", label: t("theme.dark"), icon: <MoonIcon /> },
    { value: "system", label: t("theme.system"), icon: <MonitorIcon /> },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={t("settings.title")}
          aria-label={t("settings.title")}
        >
          <Settings2Icon />
          <span className="hidden sm:inline">{t("settings.button")}</span>
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {/* Browser agent ------------------------------------------------------ */}
        <DropdownMenuLabel className="flex items-center gap-2">
          <BotIcon className="size-4" /> {t("agent.title")}
        </DropdownMenuLabel>
        <div className="flex items-start justify-between gap-3 px-2 py-1.5">
          <div className="space-y-0.5">
            <p className="text-sm">{t("agent.allow")}</p>
            <p className="text-muted-foreground text-xs">
              {webmcp ? t("agent.webmcpYes") : t("agent.webmcpNo")}
            </p>
          </div>
          <Switch checked={agentEnabled} onCheckedChange={setAgentEnabled} />
        </div>
        {agentEnabled ? (
          <div className="text-muted-foreground max-h-28 overflow-auto px-2 pb-1 font-mono text-[11px] leading-tight">
            {agentTools.map((tool) => (
              <div key={tool.name} className="truncate" title={tool.description}>
                {tool.name}
              </div>
            ))}
          </div>
        ) : null}

        <DropdownMenuSeparator />

        {/* Server MCP --------------------------------------------------------- */}
        <DropdownMenuLabel>{t("mcp.title")}</DropdownMenuLabel>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div className="space-y-0.5">
            <p className="text-sm">{t("mcp.enable")}</p>
            <p className="text-muted-foreground text-xs">{t("mcp.enableHint")}</p>
          </div>
          <Switch
            checked={mcpEnabled}
            disabled={saving || mcp === null}
            onCheckedChange={(checked) => void updateMCP({ enabled: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div className="space-y-0.5">
            <p className="text-sm">{t("mcp.read")}</p>
            <p className="text-muted-foreground text-xs">{t("mcp.readHint")}</p>
          </div>
          <Switch
            checked={readEnabled}
            disabled={saving || !mcpEnabled}
            onCheckedChange={(checked) => void updateMCP({ read: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <div className="space-y-0.5">
            <p className="text-sm">{t("mcp.write")}</p>
            <p className="text-muted-foreground text-xs">{t("mcp.writeHint")}</p>
          </div>
          <Switch
            checked={writeEnabled}
            disabled={saving || !mcpEnabled}
            onCheckedChange={(checked) => void updateMCP({ write: checked })}
          />
        </div>
        {mcp !== null && !mcpEnabled ? (
          <p className="text-muted-foreground px-2 pb-1 text-xs">{t("mcp.disabledHint")}</p>
        ) : null}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <code className="bg-muted min-w-0 flex-1 truncate rounded px-1.5 py-1 text-[11px]">
            {mcpUrl}
          </code>
          <Button variant="ghost" size="icon-sm" onClick={copyMCP} title={t("common.copy")}>
            {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
          </Button>
        </div>

        <DropdownMenuSeparator />

        {/* Language / theme --------------------------------------------------- */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages /> {t("lang.label")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-32">
              {languageOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => setLocale(option.value)}
                  className="gap-2"
                >
                  {option.label}
                  {locale === option.value ? <CheckIcon className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === "dark" ? <MoonIcon /> : theme === "light" ? <SunIcon /> : <MonitorIcon />}
              {t("theme.title")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {themeOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => setTheme(option.value)}
                  className="gap-2"
                >
                  {option.icon}
                  {option.label}
                  {theme === option.value ? <CheckIcon className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        {authEnabled ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void api.authLogout().then(() => window.location.reload())
              }}
            >
              <LogOut /> {t("auth.signOut")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
