import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  COLUMN_COLOR_OPERATORS,
  COLUMN_COLOR_STYLES,
  type ColumnColorOperator,
  type ColumnColorRule,
  type ColumnColorStyle,
} from "@/lib/columnPrefs"
import { colorWithAlpha } from "@/lib/columnColors"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const PRESET_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
  "#64748b",
]

function newRule(): ColumnColorRule {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operator: "eq",
    value: "",
    color: PRESET_COLORS[0],
    style: "text",
  }
}

export interface ColumnColorsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: string
  rules: ColumnColorRule[]
  onSave: (rules: ColumnColorRule[]) => void
}

/** Edit the ordered, first-match-wins color rules for one column. */
export function ColumnColorsDialog({
  open,
  onOpenChange,
  column,
  rules,
  onSave,
}: ColumnColorsDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<ColumnColorRule[]>(rules)

  React.useEffect(() => {
    if (open) setDraft(rules)
  }, [open, rules])

  const update = (id: string, patch: Partial<ColumnColorRule>) => {
    setDraft((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }
  const remove = (id: string) => setDraft((prev) => prev.filter((rule) => rule.id !== id))

  const save = () => {
    onSave(draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("colors.title")}</DialogTitle>
          <DialogDescription>
            {t("colors.desc", { column: column || "—" })}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto py-2 pr-1">
          {draft.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("colors.empty")}</p>
          ) : null}
          {draft.map((rule, index) => (
            <div key={rule.id} className="bg-muted/30 space-y-2 rounded-md border p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-6 shrink-0 text-xs tabular-nums">
                  {index + 1}
                </span>
                <Select
                  value={rule.operator}
                  onValueChange={(value) =>
                    update(rule.id, { operator: value as ColumnColorOperator })
                  }
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_COLOR_OPERATORS.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {t(`colors.op.${operator}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rule.operator !== "empty" && rule.operator !== "notEmpty" ? (
                  <Input
                    value={rule.value}
                    onChange={(event) => update(rule.id, { value: event.target.value })}
                    placeholder={t("colors.valuePlaceholder")}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                ) : (
                  <span className="text-muted-foreground flex-1 text-xs">{t("colors.noValue")}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("colors.remove")}
                  title={t("colors.remove")}
                  onClick={() => remove(rule.id)}
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-8">
                <Select
                  value={rule.style}
                  onValueChange={(value) =>
                    update(rule.id, { style: value as ColumnColorStyle })
                  }
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_COLOR_STYLES.map((style) => (
                      <SelectItem key={style} value={style}>
                        {t(`colors.style.${style}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{t("colors.color")}</span>
                  <input
                    type="color"
                    value={rule.color}
                    onChange={(event) => update(rule.id, { color: event.target.value })}
                    aria-label={t("colors.color")}
                    className="border-input size-8 cursor-pointer rounded border bg-transparent p-0.5"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      title={color}
                      onClick={() => update(rule.id, { color })}
                      className={cn(
                        "size-5 rounded-full border transition-transform hover:scale-110",
                        rule.color.toLowerCase() === color ? "ring-primary ring-2 ring-offset-1" : "",
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <span
                  className="ml-auto rounded px-2 py-0.5 text-[10px] font-medium"
                  style={
                    rule.style === "text"
                      ? { color: rule.color }
                      : {
                          backgroundColor: colorWithAlpha(rule.color, 0.16),
                          color: rule.color,
                        }
                  }
                >
                  {t("colors.preview")}
                </span>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDraft((prev) => [...prev, newRule()])}>
              <Plus /> {t("colors.add")}
            </Button>
            {draft.length > 0 ? (
              <Button variant="ghost" onClick={() => setDraft([])}>
                {t("colors.clear")}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save}>{t("common.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { PRESET_COLORS }
