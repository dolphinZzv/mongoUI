import { FolderPlus, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ConditionRow } from "./condition-row"
import {
  MAX_GROUP_DEPTH,
  newCondition,
  newGroup,
  type BuilderNode,
  type Combinator,
  type GroupNode,
} from "./model"

interface GroupEditorProps {
  group: GroupNode
  depth: number
  fields: string[]
  fieldTypes: Record<string, string>
  onChange: (next: GroupNode) => void
  onRemove?: () => void
}

export function GroupEditor({ group, depth, fields, fieldTypes, onChange, onRemove }: GroupEditorProps) {
  const { t } = useI18n()

  const replaceChild = (index: number, next: BuilderNode) => {
    const children = group.children.slice()
    children[index] = next
    onChange({ ...group, children })
  }
  const removeChild = (index: number) => {
    onChange({ ...group, children: group.children.filter((_, i) => i !== index) })
  }

  return (
    <div
      className={cn(
        "rounded-md border p-2",
        depth > 0 && "bg-muted/20 border-dashed",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={group.combinator}
          onValueChange={(value) => onChange({ ...group, combinator: value as Combinator })}
        >
          <SelectTrigger size="sm" className="w-24" aria-label={t("filter.combinator")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">{t("filter.and")}</SelectItem>
            <SelectItem value="or">{t("filter.or")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          {group.combinator === "and" ? t("filter.matchAll") : t("filter.matchAny")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...group, children: [...group.children, newCondition()] })}
          >
            <Plus /> {t("filter.addCondition")}
          </Button>
          {depth < MAX_GROUP_DEPTH ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ ...group, children: [...group.children, newGroup("or")] })
              }
            >
              <FolderPlus /> {t("filter.addGroup")}
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              title={t("filter.removeGroup")}
              aria-label={t("filter.removeGroup")}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {group.children.length === 0 ? (
          <p className="text-muted-foreground px-1 py-1.5 text-xs">{t("filter.emptyBuilder")}</p>
        ) : null}
        {group.children.map((child, index) =>
          child.kind === "condition" ? (
            <ConditionRow
              key={child.id}
              condition={child}
              fields={fields}
              fieldTypes={fieldTypes}
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ) : (
            <GroupEditor
              key={child.id}
              group={child}
              depth={depth + 1}
              fields={fields}
              fieldTypes={fieldTypes}
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </div>
    </div>
  )
}
