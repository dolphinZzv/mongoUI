import { CheckIcon, Languages } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOCALES, useI18n } from "@/lib/i18n"

/** Language switcher (English / 中文), persisted in localStorage. */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className}
          title={t("lang.label")}
          aria-label={t("lang.label")}
        >
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setLocale(option.value)}
            className="gap-2"
          >
            {option.label}
            {locale === option.value ? <CheckIcon className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
