import { Trash2 } from "lucide-react"

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
import { cn } from "@/lib/utils"
import { operatorFor, QUERY_OPERATORS, type ConditionNode } from "./model"

interface ConditionRowProps {
  condition: ConditionNode
  fields: string[]
  fieldTypes: Record<string, string>
  onChange: (next: ConditionNode) => void
  onRemove: () => void
}

export function ConditionRow({ condition, fields, fieldTypes, onChange, onRemove }: ConditionRowProps) {
  const { t } = useI18n()
  const operator = operatorFor(condition.operator)
  const listId = `qb-fields-${condition.id}`
  const fieldType = fieldTypes[condition.field]
  const numericField =
    fieldType === "int" ||
    fieldType === "double" ||
    fieldType === "long" ||
    fieldType === "decimal"
  const invalidObjectId =
    fieldType === "objectId" &&
    operator.kind !== "array" &&
    condition.value.trim() !== "" &&
    !/^[0-9a-fA-F]{24}$/.test(condition.value.trim())
  const showBoolean =
    operator.kind === "boolean" || (operator.kind === "value" && fieldType === "bool")

  const changeOperator = (nextOperator: string) => {
    const meta = operatorFor(nextOperator)
    let value = condition.value
    if (meta.kind === "boolean" && value !== "true" && value !== "false") value = "true"
    if (meta.kind === "array" && !value.trim()) value = "[]"
    onChange({ ...condition, operator: nextOperator, value })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        list={listId}
        value={condition.field}
        onChange={(event) => onChange({ ...condition, field: event.target.value })}
        placeholder={t("filter.field")}
        aria-label={t("filter.field")}
        spellCheck={false}
        className="h-8 w-40 font-mono text-xs"
      />
      <datalist id={listId}>
        {fields.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>

      <Select value={condition.operator} onValueChange={changeOperator}>
        <SelectTrigger size="sm" className="w-44" aria-label={t("filter.operator")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUERY_OPERATORS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="font-mono">{item.value}</span>
              <span className="text-muted-foreground text-xs">{t(item.labelKey)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showBoolean ? (
        <Select
          value={condition.value === "false" ? "false" : "true"}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger size="sm" className="w-24" aria-label={t("filter.value")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : fieldType === "date" && operator.kind === "value" ? (
        <Input
          type="datetime-local"
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          aria-label={t("filter.value")}
          className="h-8 min-w-40 flex-1 text-xs"
        />
      ) : (
        <Input
          type={numericField && (operator.kind === "value" || operator.kind === "number") ? "number" : "text"}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          placeholder={
            fieldType === "objectId"
              ? "507f1f77bcf86cd799439011"
              : operator.placeholder ?? t("filter.value")
          }
          aria-label={t("filter.value")}
          spellCheck={false}
          className={cn(
            "h-8 min-w-40 flex-1 font-mono text-xs",
            invalidObjectId && "border-destructive focus-visible:ring-destructive/30",
          )}
        />
      )}
      {fieldType ? (
        <span className="text-muted-foreground shrink-0 text-[10px]">{fieldType}</span>
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        title={t("filter.removeCondition")}
        aria-label={t("filter.removeCondition")}
      >
        <Trash2 />
      </Button>
    </div>
  )
}
