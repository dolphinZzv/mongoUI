import * as React from "react"
import { Pin, PinOff } from "lucide-react"

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
export function ResultTable({
  documents,
  columns,
  storageKey,
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
  const pinnedColumns = React.useMemo(
    () => orderedColumns.filter((column) => prefs.pinned.includes(column)),
    [orderedColumns, prefs.pinned],
  )
  const displayColumns = React.useMemo(() => {
    const pinnedSet = new Set(pinnedColumns)
    return [...pinnedColumns, ...orderedColumns.filter((column) => !pinnedSet.has(column))]
  }, [orderedColumns, pinnedColumns])

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
      <div
        ref={frozen.scrollRef}
        onScroll={frozen.onScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-auto"
      >
        <Table>
          <TableHeader className="bg-background sticky top-0 z-20">
            <TableRow className="hover:bg-transparent">
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
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 2rem" }}
              >
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
