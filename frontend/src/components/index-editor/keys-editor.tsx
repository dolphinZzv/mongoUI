import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import { KEY_TYPES, type KeyRow } from "./model"

interface KeysEditorProps {
  rows: KeyRow[]
  fieldNames: string[]
  onUpdateRow: (id: string, patch: Partial<KeyRow>) => void
  onMoveRow: (from: number, to: number) => void
  onRemoveRow: (id: string) => void
  onAddRow: () => void
}

/** Ordered list of index key fields with direction/type selection. */
export function KeysEditor({
  rows,
  fieldNames,
  onUpdateRow,
  onMoveRow,
  onRemoveRow,
  onAddRow,
}: KeysEditorProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t("indexes.keys")}</label>
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            list="mongoui-index-fields"
            value={row.field}
            placeholder={t("indexes.fieldPlaceholder")}
            onChange={(event) => onUpdateRow(row.id, { field: event.target.value })}
            className="flex-1 font-mono text-xs"
          />
          <Select value={row.type} onValueChange={(value) => onUpdateRow(row.id, { type: value })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEY_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {t(type.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={i === 0}
            onClick={() => onMoveRow(i, i - 1)}
            title={t("indexes.moveUp")}
            aria-label={t("indexes.moveUp")}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={i === rows.length - 1}
            onClick={() => onMoveRow(i, i + 1)}
            title={t("indexes.moveDown")}
            aria-label={t("indexes.moveDown")}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={rows.length === 1}
            onClick={() => onRemoveRow(row.id)}
            title={t("common.delete")}
            aria-label={t("common.delete")}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={onAddRow}>
        <Plus /> {t("indexes.addField")}
      </Button>
      <datalist id="mongoui-index-fields">
        {fieldNames.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
    </div>
  )
}
