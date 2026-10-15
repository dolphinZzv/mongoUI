import * as React from "react"
import { Columns3, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useI18n } from "@/lib/i18n"

interface ColumnsPickerProps {
  /** Every field present in the current result page. */
  columns: string[]
  /** Fields currently hidden. */
  hidden: string[]
  onHiddenChange: (hidden: string[]) => void
  onReset: () => void
}

/**
 * Searchable field visibility picker for the documents table. Supports
 * filtering a long field list, select-all and invert, and shows how many of
 * the total fields are visible.
 */
export function ColumnsPicker({ columns, hidden, onHiddenChange, onReset }: ColumnsPickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const hiddenSet = React.useMemo(() => new Set(hidden), [hidden])
  const visibleCount = columns.filter((column) => !hiddenSet.has(column)).length

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return columns
    return columns.filter((column) => column.toLowerCase().includes(needle))
  }, [columns, query])

  const toggle = (column: string, visible: boolean) => {
    onHiddenChange(
      visible
        ? hidden.filter((candidate) => candidate !== column)
        : Array.from(new Set([...hidden, column])),
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          title={t("docs.columns")}
          aria-label={t("docs.columns")}
        >
          <Columns3 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">{t("docs.columns")}</span>
          <span className="text-muted-foreground text-[11px]">
            {t("docs.fieldsSelected", { selected: visibleCount, total: columns.length })}
          </span>
        </div>
        <div className="space-y-2 p-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("docs.searchFields")}
              aria-label={t("docs.searchFields")}
              spellCheck={false}
              autoComplete="off"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 px-2 text-[11px]"
              onClick={() => onHiddenChange([])}
            >
              {t("docs.selectAll")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 px-2 text-[11px]"
              onClick={() =>
                onHiddenChange(columns.filter((column) => !hiddenSet.has(column)))
              }
            >
              {t("docs.invertSelection")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onReset}
            >
              {t("docs.resetColumns")}
            </Button>
          </div>
          <div className="scrollbar-thin max-h-64 space-y-0.5 overflow-auto">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground px-2 py-4 text-center text-xs">
                {t("docs.noFieldsMatch")}
              </p>
            ) : null}
            {filtered.map((column) => (
              <label
                key={column}
                className="hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs"
              >
                <Checkbox
                  checked={!hiddenSet.has(column)}
                  onCheckedChange={(checked) => toggle(column, checked === true)}
                  aria-label={column}
                />
                <span className="truncate font-mono">{column}</span>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
