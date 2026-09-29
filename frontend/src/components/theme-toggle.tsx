import * as React from "react"
import { CheckIcon, ChevronDownIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"
import { useTheme, type Theme } from "@/lib/theme"

/**
 * A labelled theme switcher. It intentionally shows the current mode as text so
 * the control is easy to find (an icon-only button was too subtle).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { t } = useI18n()

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("theme.light"), icon: <SunIcon /> },
    { value: "dark", label: t("theme.dark"), icon: <MoonIcon /> },
    { value: "system", label: t("theme.system"), icon: <MonitorIcon /> },
  ]
  const current = options.find((option) => option.value === theme) ?? options[2]
  const ResolvedIcon = resolvedTheme === "dark" ? MoonIcon : SunIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className}
          aria-label={t("theme.aria", { label: current.label })}
          title={t("theme.title")}
        >
          <ResolvedIcon />
          <span>{current.label}</span>
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map((option) => (
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
