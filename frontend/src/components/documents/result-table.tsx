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
import { useI18n } from "@/lib/i18n"
import { classForType, formatValue, valueType } from "@/lib/mongo"
import { readResultPinned, resultPinnedKey, writeResultPinned } from "@/lib/resultTablePrefs"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

/** Inset shadow marking the right edge of the frozen region once scrolled. */
const PINNED_EDGE_SHADOW = "cell-frozen-edge"

interface ResultTableProps {
  documents: MongoDocument[]
  columns: string[]
  /** localStorage scope for the pinned-column choice, e.g. `sql:conn:db:col`. */
  storageKey: string
}

/**
 * Read-only result grid shared by the SQL, aggregation and script views.
 * Columns can be pinned to the left edge so they stay visible while scrolling
 * horizontally; the choice is remembered per `storageKey`.
 */
export function ResultTable({ documents, columns, storageKey }: ResultTableProps) {
  const { t } = useI18n()
  const prefsKey = resultPinnedKey(storageKey)
  const [pinned, setPinned] = React.useState<string[]>(() => readResultPinned(prefsKey))

  // Reload the stored choice when the caller switches collection/tab.
  React.useEffect(() => {
    setPinned(readResultPinned(prefsKey))
  }, [prefsKey])

  React.useEffect(() => {
    writeResultPinned(prefsKey, pinned)
  }, [prefsKey, pinned])

  // Only pin columns that are actually present in this result.
  const pinnedColumns = React.useMemo(
    () => columns.filter((column) => pinned.includes(column)),
    [columns, pinned],
  )
  const displayColumns = React.useMemo(() => {
    const pinnedSet = new Set(pinnedColumns)
    return [...pinnedColumns, ...columns.filter((column) => !pinnedSet.has(column))]
  }, [columns, pinnedColumns])

  const frozen = useFrozenColumns(pinnedColumns)
  const pinnedSet = React.useMemo(() => new Set(pinnedColumns), [pinnedColumns])

  const togglePinned = (column: string) => {
    setPinned((prev) =>
      prev.includes(column) ? prev.filter((item) => item !== column) : [...prev, column],
    )
  }

  return (
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
                  scope="col"
                  className={cn(
                    "group font-mono text-xs",
                    isPinned ? "cell-frozen sticky z-30" : "relative",
                    isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
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
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc, index) => (
            <TableRow key={index}>
              {displayColumns.map((column) => {
                const value = doc[column]
                const isPinned = pinnedSet.has(column)
                const left = frozen.offsets[column]
                const isLastPinned =
                  isPinned && pinnedColumns[pinnedColumns.length - 1] === column
                return (
                  <TableCell
                    key={column}
                    data-column={column}
                    className={cn(
                      "max-w-[320px] truncate",
                      isPinned && "cell-frozen sticky z-10",
                      isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
                    )}
                    style={isPinned && left !== undefined ? { left } : undefined}
                  >
                    <span
                      className={cn("font-mono text-xs", classForType(valueType(value)))}
                      title={formatValue(value)}
                    >
                      {formatValue(value).slice(0, 90)}
                    </span>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
