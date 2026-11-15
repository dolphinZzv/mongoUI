import * as React from "react"
import { Columns3, Pin, PinOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useFrozenColumns } from "@/hooks/useFrozenColumns"
import { useColumnDrag } from "@/hooks/useColumnDrag"
import { columnColorRule, columnColorStyle } from "@/lib/columnColors"
import { useI18n } from "@/lib/i18n"
import {
  readResultTablePrefs,
  resultTablePrefsKey,
  writeResultTablePrefs,
  type ResultTablePrefs,
} from "@/lib/resultTablePrefs"
import { cn } from "@/lib/utils"
import {
  columnRenderMode,
  reorderVisibleColumns,
  type ColumnColorRules,
  type ColumnDictionaries,
  type ColumnDropPosition,
  type ColumnRenderers,
} from "@/lib/columnPrefs"
import type { MongoDocument } from "@/lib/types"
import {
  CellValue,
  cellValueOverflows,
  isPreviewableValue,
} from "@/components/documents/cell"
import { CellValueDialog } from "@/components/documents/cell-value-dialog"

/** Inset shadow marking the right edge of the frozen region once scrolled. */
const PINNED_EDGE_SHADOW = "cell-frozen-edge"

/** Apply a saved order to the columns present in this result. */
function orderColumns(columns: string[], order: string[]): string[] {
  const present = new Set(columns)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const column of order) {
    if (present.has(column) && !seen.has(column)) {
      ordered.push(column)
      seen.add(column)
    }
  }
  for (const column of columns) {
    if (!seen.has(column)) {
      ordered.push(column)
      seen.add(column)
    }
  }
  return ordered
}

interface ResultTableProps {
  documents: MongoDocument[]
  columns: string[]
  /** localStorage scope for the pinned-column choice, e.g. `sql:conn:db:col`. */
  storageKey: string
  /** Optional row selection used by the query result toolbar. */
  selectable?: boolean
  selected?: Set<number>
  onSelectedChange?: (next: Set<number>) => void
  /** Optional raw-value → display-label mappings from the collection prefs. */
  dictionaries?: ColumnDictionaries
  renderers?: ColumnRenderers
  colors?: ColumnColorRules
}

/**
 * Read-only result grid shared by the SQL, aggregation and script views.
 * Columns can be dragged into a new order and pinned to the left edge so they
 * stay visible while scrolling horizontally; both choices are remembered per
 * `storageKey`.
 */
const EMPTY_SELECTION = new Set<number>()

export function ResultTable({
  documents,
  columns,
  storageKey,
  selectable = false,
  selected = EMPTY_SELECTION,
  onSelectedChange,
  dictionaries,
  renderers,
  colors,
}: ResultTableProps) {
  const { t } = useI18n()
  const prefsKey = resultTablePrefsKey(storageKey)
  const [prefs, setPrefs] = React.useState<ResultTablePrefs>(() =>
    readResultTablePrefs(prefsKey),
  )
  const [valuePreview, setValuePreview] = React.useState<{
    column: string
    value: unknown
  } | null>(null)

  // Reload the stored choice when the caller switches collection/tab.
  React.useEffect(() => {
    setPrefs(readResultTablePrefs(prefsKey))
  }, [prefsKey])

  React.useEffect(() => {
    writeResultTablePrefs(prefsKey, prefs)
  }, [prefsKey, prefs])

  const orderedColumns = React.useMemo(
    () => orderColumns(columns, prefs.order),
    [columns, prefs.order],
  )
  // Only pin columns that are actually present in this result.
  const hiddenSet = React.useMemo(() => new Set(prefs.hidden), [prefs.hidden])
  const pinnedColumns = React.useMemo(
    () =>
      orderedColumns.filter(
        (column) => prefs.pinned.includes(column) && !hiddenSet.has(column),
      ),
    [orderedColumns, prefs.pinned, hiddenSet],
  )
  const visibleColumns = React.useMemo(
    () => orderedColumns.filter((column) => !hiddenSet.has(column)),
    [orderedColumns, hiddenSet],
  )
  const displayColumns = React.useMemo(() => {
    const pinnedSet = new Set(pinnedColumns)
    return [
      ...pinnedColumns.filter((column) => !hiddenSet.has(column)),
      ...visibleColumns.filter((column) => !pinnedSet.has(column)),
    ]
  }, [pinnedColumns, visibleColumns, hiddenSet])
  const allSelected = documents.length > 0 && documents.every((_, index) => selected.has(index))
  const someSelected = documents.some((_, index) => selected.has(index))

  const toggleAll = (checked: boolean) => {
    if (!onSelectedChange) return
    onSelectedChange(checked ? new Set(documents.map((_, index) => index)) : new Set())
  }

  const toggleRow = (index: number, checked: boolean) => {
    if (!onSelectedChange) return
    const next = new Set(selected)
    if (checked) next.add(index)
    else next.delete(index)
    onSelectedChange(next)
  }

  const toggleColumn = (column: string, visible: boolean) => {
    setPrefs((prev) => ({
      ...prev,
      hidden: visible
        ? prev.hidden.filter((item) => item !== column)
        : [...new Set([...prev.hidden, column])],
    }))
  }

  const frozen = useFrozenColumns(pinnedColumns)
  const pinnedSet = React.useMemo(() => new Set(pinnedColumns), [pinnedColumns])

  const togglePinned = (column: string) => {
    setPrefs((prev) => ({
      ...prev,
      pinned: prev.pinned.includes(column)
        ? prev.pinned.filter((item) => item !== column)
        : [...prev.pinned, column],
    }))
  }

  const canDropColumn = React.useCallback(
    (source: string, target: string) =>
      source !== target && pinnedSet.has(source) === pinnedSet.has(target),
    [pinnedSet],
  )
  const reorderColumn = React.useCallback(
    (source: string, target: string, position: ColumnDropPosition) => {
      setPrefs((prev) => {
        const order = reorderVisibleColumns(
          prev.order,
          displayColumns,
          orderedColumns,
          prev.pinned,
          source,
          target,
          position,
        )
        return order === prev.order ? prev : { ...prev, order }
      })
    },
    [displayColumns, orderedColumns],
  )
  const { dragSource, dropTarget, headerProps } = useColumnDrag({
    canDrop: canDropColumn,
    onDrop: reorderColumn,
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="bg-background flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
          {selectable && selected.size > 0 ? (
            <span className="text-muted-foreground mr-auto text-[11px]">{selected.size}</span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("result.columns")}
                aria-label={t("result.columns")}
                data-testid="query-columns"
              >
                <Columns3 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-auto">
              <DropdownMenuLabel>{t("result.columns")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {orderedColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={!hiddenSet.has(column)}
                  onCheckedChange={(checked) => toggleColumn(column, Boolean(checked))}
                  onSelect={(event) => event.preventDefault()}
                  className="font-mono text-xs"
                >
                  {column}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setPrefs((prev) => ({ ...prev, hidden: [] }))}
              >
                {t("result.showAllColumns")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          ref={frozen.scrollRef}
          onScroll={frozen.onScroll}
          className="scrollbar-thin min-h-0 flex-1 overflow-auto"
        >
          <Table>
          <TableHeader className="bg-background sticky top-0 z-20">
            <TableRow className="hover:bg-transparent">
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAll(Boolean(checked))}
                    aria-label={t("result.selectAll")}
                  />
                </TableHead>
              ) : null}
              {displayColumns.map((column) => {
                const isPinned = pinnedSet.has(column)
                const left = frozen.offsets[column]
                const isLastPinned =
                  isPinned && pinnedColumns[pinnedColumns.length - 1] === column
                return (
                  <TableHead
                    key={column}
                    data-column={column}
                    data-dragging={dragSource === column ? "true" : undefined}
                    scope="col"
                    title={t("docs.dragColumn")}
                    {...headerProps(column)}
                    className={cn(
                      "group cursor-grab font-mono text-xs active:cursor-grabbing",
                      isPinned ? "cell-frozen sticky z-30" : "relative",
                      isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
                      dragSource === column && "opacity-50",
                    )}
                    style={isPinned && left !== undefined ? { left } : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate">{column}</span>
                      <button
                        type="button"
                        onClick={() => togglePinned(column)}
                        title={isPinned ? t("docs.unpinColumn") : t("docs.pinColumn")}
                        aria-label={isPinned ? t("docs.unpinColumn") : t("docs.pinColumn")}
                        aria-pressed={isPinned}
                        className={cn(
                          "shrink-0 rounded p-0.5 transition-opacity",
                          isPinned
                            ? "text-primary opacity-100"
                            : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        )}
                      >
                        {isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                      </button>
                    </div>
                    {dropTarget?.column === column && dragSource ? (
                      <span
                        aria-hidden
                        className={cn(
                          "bg-primary pointer-events-none absolute inset-y-0 z-40 w-0.5",
                          dropTarget.position === "before" ? "left-0" : "right-0",
                        )}
                      />
                    ) : null}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc, index) => (
              <TableRow
                key={index}
                data-selected={selectable && selected.has(index) ? "true" : undefined}
                className={selectable && selected.has(index) ? "bg-primary/5" : undefined}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 2rem" }}
              >
                {selectable ? (
                  <TableCell className="w-10">
                    <Checkbox
                      checked={selected.has(index)}
                      onCheckedChange={(checked) => toggleRow(index, Boolean(checked))}
                      aria-label={t("result.selectRow", { row: index + 1 })}
                    />
                  </TableCell>
                ) : null}
                {displayColumns.map((column) => {
                  const value = doc[column]
                  const isPinned = pinnedSet.has(column)
                  const left = frozen.offsets[column]
                  const isLastPinned =
                    isPinned && pinnedColumns[pinnedColumns.length - 1] === column
                  const previewable = isPreviewableValue(value)
                  const colorRule = columnColorRule(colors, column, value)
                  return (
                    <TableCell
                      key={column}
                      data-column={column}
                      className={cn(
                        "max-w-[320px] truncate",
                        previewable && "cursor-pointer",
                        isPinned && "cell-frozen sticky z-10",
                        isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
                      )}
                      style={{
                        ...(isPinned && left !== undefined ? { left } : undefined),
                        ...(columnColorStyle(colorRule, "background") ?? {}),
                      }}
                      onClick={(event) => {
                        if (!cellValueOverflows(event.currentTarget)) return
                        setValuePreview({ column, value })
                      }}
                    >
                      <CellValue
                        value={value}
                        colorStyle={columnColorStyle(colorRule, "text")}
                        dictionary={dictionaries?.[column]}
                        renderer={columnRenderMode(renderers, dictionaries, column)}
                        onExpand={() => setValuePreview({ column, value })}
                      />
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </div>
      </div>
      <CellValueDialog
        open={valuePreview !== null}
        onOpenChange={(open) => {
          if (!open) setValuePreview(null)
        }}
        column={valuePreview?.column ?? ""}
        value={valuePreview?.value}
      />
    </>
  )
}
