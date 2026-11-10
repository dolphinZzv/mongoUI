import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Shortcut {
  keys: string[]
  labelKey: string
}

const GENERAL: Shortcut[] = [
  { keys: ["mod", "K"], labelKey: "shortcuts.commandPalette" },
  { keys: ["?"], labelKey: "shortcuts.help" },
  { keys: ["Esc"], labelKey: "shortcuts.close" },
  { keys: ["alt", "["], labelKey: "shortcuts.prevTab" },
  { keys: ["alt", "]"], labelKey: "shortcuts.nextTab" },
  { keys: ["alt", "1..9"], labelKey: "shortcuts.tabByNumber" },
  { keys: ["alt", "shift", "W"], labelKey: "shortcuts.closeTab" },
  { keys: ["alt", "shift", "T"], labelKey: "shortcuts.reopenTab" },
  { keys: ["mod", "S"], labelKey: "shortcuts.saveView" },
  { keys: ["shift", "alt", "F"], labelKey: "shortcuts.formatQuery" },
  { keys: ["shift", "alt", "G"], labelKey: "shortcuts.chart" },
]

const TABLE: Shortcut[] = [
  { keys: ["/"], labelKey: "shortcuts.focusFilter" },
  { keys: ["mod", "Enter"], labelKey: "shortcuts.runQuery" },
  { keys: ["j", "k"], labelKey: "shortcuts.moveRows" },
  { keys: ["h", "l"], labelKey: "shortcuts.moveCell" },
  { keys: ["Enter"], labelKey: "shortcuts.editCell" },
  { keys: ["y"], labelKey: "shortcuts.copyValue" },
  { keys: ["f"], labelKey: "shortcuts.copyField" },
  { keys: ["i"], labelKey: "shortcuts.copyId" },
  { keys: ["c"], labelKey: "shortcuts.copySet" },
  { keys: ["o"], labelKey: "shortcuts.previewCell" },
  { keys: ["Space"], labelKey: "shortcuts.toggle" },
  { keys: ["e"], labelKey: "shortcuts.edit" },
  { keys: ["Delete"], labelKey: "shortcuts.delete" },
]

function isMac() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

function renderKey(key: string, mac: boolean): string {
  if (key === "mod") return mac ? "⌘" : "Ctrl"
  if (key === "alt") return mac ? "⌥" : "Alt"
  if (key === "shift") return mac ? "⇧" : "Shift"
  if (key === "Space") return "Space"
  return key
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const { t } = useI18n()
  const mac = React.useMemo(isMac, [])

  const renderGroup = (title: string, shortcuts: Shortcut[]) => (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {title}
      </p>
      {shortcuts.map((shortcut) => (
        <div key={shortcut.labelKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="text-sm">{t(shortcut.labelKey)}</span>
          <span className="flex shrink-0 items-center gap-1">
            {shortcut.keys.map((key) => (
              <kbd
                key={key}
                className="bg-muted text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[11px]"
              >
                {renderKey(key, mac)}
              </kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          {renderGroup(t("shortcuts.general"), GENERAL)}
          {renderGroup(t("shortcuts.table"), TABLE)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
