import { classForType, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

/** A single BSON value rendered as a type-colored, truncated monospace cell. */
export function CellValue({ value }: { value: unknown }) {
  const type = valueType(value)
  const text = formatValue(value)
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground font-mono text-xs italic">null</span>
  }
  const display = text.length > 90 ? `${text.slice(0, 90)}…` : text
  return (
    <span className={cn("font-mono text-xs", classForType(type))} title={text}>
      {display}
    </span>
  )
}

interface CellContextMenuProps {
  x: number
  y: number
  column: string
  value: unknown
  document: MongoDocument
  onCopy: (text: string) => void
}

/** Right-click menu for a table cell: copy value / JSON / field / _id / $set. */
export function CellContextMenu({
  x,
  y,
  column,
  value,
  document,
  onCopy,
}: CellContextMenuProps) {
  const { t } = useI18n()
  const item =
    "hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"

  return (
    <div
      data-cell-menu
      style={{ top: y, left: x }}
      className="bg-popover text-popover-foreground fixed z-50 min-w-44 rounded-md border p-1 shadow-md"
    >
      <button type="button" onClick={() => onCopy(formatValue(value))} className={item}>
        {t("docs.copyValue")}
      </button>
      <button
        type="button"
        onClick={() => onCopy(JSON.stringify(value, null, 2))}
        className={item}
      >
        {t("docs.copyValueJson")}
      </button>
      <button type="button" onClick={() => onCopy(column)} className={item}>
        {t("docs.copyField")}
      </button>
      <div className="bg-border -mx-1 my-1 h-px" />
      {"_id" in document ? (
        <button type="button" onClick={() => onCopy(prettyJSON(document._id))} className={item}>
          {t("docs.copyId")}
        </button>
      ) : null}
      <button type="button" onClick={() => onCopy(prettyJSON(document))} className={item}>
        {t("docs.copyDocument")}
      </button>
      <div className="bg-border -mx-1 my-1 h-px" />
      <button
        type="button"
        onClick={() => onCopy(prettyJSON({ $set: { [column]: value } }))}
        className={item}
      >
        {t("docs.copyAsSet")}
      </button>
    </div>
  )
}
