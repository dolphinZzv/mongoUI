import * as React from "react"
import { FolderPlus, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useI18n } from "@/lib/i18n"
import { isPlainObject } from "@/lib/mongo"
import { cn } from "@/lib/utils"

/**
 * A visual MongoDB query builder.
 *
 * The user composes filter conditions (field / operator / value) and nests them
 * into AND / OR groups, and picks which columns are returned (the projection).
 * The component compiles both into plain MongoDB objects and hands the JSON
 * back to the caller, which is why it can sit on top of the existing JSON
 * editors without changing the query pipeline.
 *
 * Values are parsed as JSON first, so numbers, booleans, null, arrays and
 * nested objects / Extended JSON keep their type; anything that is not valid
 * JSON is treated as a plain string.
 */

type Combinator = "and" | "or"

interface ConditionNode {
  id: string
  kind: "condition"
  field: string
  operator: string
  value: string
}

interface GroupNode {
  id: string
  kind: "group"
  combinator: Combinator
  children: BuilderNode[]
}

type BuilderNode = ConditionNode | GroupNode

interface QueryOperator {
  value: string
  labelKey: string
  kind: "value" | "boolean" | "array" | "number"
  placeholder?: string
}

const QUERY_OPERATORS: QueryOperator[] = [
  { value: "$eq", labelKey: "filter.op.eq", kind: "value" },
  { value: "$ne", labelKey: "filter.op.ne", kind: "value" },
  { value: "$gt", labelKey: "filter.op.gt", kind: "value" },
  { value: "$gte", labelKey: "filter.op.gte", kind: "value" },
  { value: "$lt", labelKey: "filter.op.lt", kind: "value" },
  { value: "$lte", labelKey: "filter.op.lte", kind: "value" },
  { value: "$in", labelKey: "filter.op.in", kind: "array", placeholder: '["a", "b"]' },
  { value: "$nin", labelKey: "filter.op.nin", kind: "array", placeholder: '["a", "b"]' },
  { value: "$exists", labelKey: "filter.op.exists", kind: "boolean" },
  { value: "$regex", labelKey: "filter.op.regex", kind: "value", placeholder: "^abc" },
  { value: "$all", labelKey: "filter.op.all", kind: "array", placeholder: '["a", "b"]' },
  { value: "$size", labelKey: "filter.op.size", kind: "number", placeholder: "3" },
  { value: "$type", labelKey: "filter.op.type", kind: "value", placeholder: "string" },
  { value: "$elemMatch", labelKey: "filter.op.elemMatch", kind: "value", placeholder: '{ "x": 1 }' },
  { value: "$not", labelKey: "filter.op.not", kind: "value", placeholder: '{ "$gt": 5 }' },
]

const MAX_GROUP_DEPTH = 2

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `qb-${idCounter}`
}

function operatorFor(value: string): QueryOperator {
  return QUERY_OPERATORS.find((op) => op.value === value) ?? QUERY_OPERATORS[0]
}

function newCondition(field = ""): ConditionNode {
  return { id: nextId(), kind: "condition", field, operator: "$eq", value: "" }
}

function newGroup(combinator: Combinator): GroupNode {
  return { id: nextId(), kind: "group", combinator, children: [] }
}

function emptyRoot(): GroupNode {
  return newGroup("and")
}

/** Parses a single scalar, falling back to the raw string for bare words. */
function parseScalar(text: string): unknown {
  if (!text.trim()) return ""
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function parseOperatorValue(raw: string, op: QueryOperator): unknown {
  if (op.kind === "boolean") return raw === "true"
  if (op.kind === "number") {
    const parsed = Number(raw.trim())
    return Number.isFinite(parsed) ? parsed : parseScalar(raw)
  }
  if (op.kind === "array") {
    const text = raw.trim()
    if (!text) return []
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* fall through to a comma separated list */
    }
    return text.split(",").map((part) => parseScalar(part.trim()))
  }
  return parseScalar(raw)
}

function stringifyValue(value: unknown): string {
  if (value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function conditionExpression(condition: ConditionNode): Record<string, unknown> | undefined {
  const field = condition.field.trim()
  if (!field) return undefined
  const op = operatorFor(condition.operator)
  const value = parseOperatorValue(condition.value, op)
  if (condition.operator === "$eq") return { [field]: value }
  return { [field]: { [condition.operator]: value } }
}

function buildNode(node: BuilderNode): unknown {
  if (node.kind === "condition") return conditionExpression(node)
  const parts = node.children
    .map((child) => buildNode(child))
    .filter((part) => part !== undefined)
  if (parts.length === 0) return undefined
  if (parts.length === 1 && node.combinator === "and") return parts[0]
  return { [`$${node.combinator}`]: parts }
}

function buildFilter(root: GroupNode): Record<string, unknown> {
  const built = buildNode(root)
  return isPlainObject(built) ? built : {}
}

function parseObjectEntries(obj: Record<string, unknown>): BuilderNode[] {
  const nodes: BuilderNode[] = []
  for (const [key, value] of Object.entries(obj)) {
    if ((key === "$and" || key === "$or") && Array.isArray(value)) {
      const group = newGroup(key === "$and" ? "and" : "or")
      for (const item of value) {
        if (!isPlainObject(item)) continue
        const itemNodes = parseObjectEntries(item)
        if (itemNodes.length === 1) {
          group.children.push(itemNodes[0])
        } else if (itemNodes.length > 1) {
          // An array element is an implicit AND of its keys; keep that meaning
          // instead of flattening it into the parent combinator.
          group.children.push({ ...newGroup("and"), children: itemNodes })
        }
      }
      nodes.push(group)
      continue
    }
    if (key.startsWith("$")) {
      // Top level operators such as $expr / $text are kept as a condition so
      // the JSON round-trips instead of being dropped.
      nodes.push({
        id: nextId(),
        kind: "condition",
        field: key,
        operator: "$eq",
        value: stringifyValue(value),
      })
      continue
    }
    if (isPlainObject(value)) {
      const operatorKeys = Object.keys(value).filter((candidate) => candidate.startsWith("$"))
      if (operatorKeys.length > 0) {
        for (const operator of operatorKeys) {
          nodes.push({
            id: nextId(),
            kind: "condition",
            field: key,
            operator,
            value: stringifyValue(value[operator]),
          })
        }
        continue
      }
    }
    nodes.push({
      id: nextId(),
      kind: "condition",
      field: key,
      operator: "$eq",
      value: stringifyValue(value),
    })
  }
  return nodes
}

function parseFilter(input: string): GroupNode {
  const root = emptyRoot()
  let parsed: unknown
  try {
    parsed = JSON.parse(input.trim() || "{}")
  } catch {
    return root
  }
  if (!isPlainObject(parsed)) return root
  root.children = parseObjectEntries(parsed)
  return root
}

// --- projection -------------------------------------------------------------

type ProjectionMode = "none" | "include" | "exclude"

interface ProjectionState {
  mode: ProjectionMode
  /** Fields the user selected (meaning depends on the mode). */
  fields: string[]
}

function parseProjection(input: string): ProjectionState {
  const text = input.trim()
  if (!text || text === "{}") return { mode: "none", fields: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { mode: "none", fields: [] }
  }
  if (!isPlainObject(parsed)) return { mode: "none", fields: [] }
  const entries = Object.entries(parsed)
  if (entries.length === 0) return { mode: "none", fields: [] }
  const isTruthy = (value: unknown) => value === 1 || value === true
  const include = entries.some(([, value]) => isTruthy(value))
  const fields = entries
    .filter(([, value]) => (include ? isTruthy(value) : !isTruthy(value)))
    .map(([key]) => key)
  // Include projections return _id implicitly, so show it as selected unless
  // the projection explicitly excluded it.
  if (include && !("_id" in parsed)) fields.push("_id")
  return { mode: include ? "include" : "exclude", fields }
}

function buildProjection(state: ProjectionState): string {
  if (state.mode === "none") return ""
  const fields = Array.from(new Set(state.fields.map((field) => field.trim()).filter(Boolean)))
  if (fields.length === 0) return ""
  const projection: Record<string, number> = {}
  for (const field of fields) projection[field] = state.mode === "include" ? 1 : 0
  // In an inclusion projection MongoDB always returns _id unless it is
  // explicitly excluded, so hide it when the user did not select it.
  if (state.mode === "include" && !fields.includes("_id")) projection._id = 0
  return JSON.stringify(projection)
}

interface ProjectionEditorProps {
  state: ProjectionState
  knownFields: string[]
  onChange: (next: ProjectionState) => void
}

function ProjectionEditor({ state, knownFields, onChange }: ProjectionEditorProps) {
  const { t } = useI18n()
  const [custom, setCustom] = React.useState("")

  const options = React.useMemo(() => {
    const set = new Set<string>(["_id"])
    for (const field of knownFields) if (field) set.add(field)
    for (const field of state.fields) if (field) set.add(field)
    return Array.from(set).sort((a, b) =>
      a === "_id" ? -1 : b === "_id" ? 1 : a.localeCompare(b),
    )
  }, [knownFields, state.fields])

  const toggle = (field: string) => {
    const has = state.fields.includes(field)
    onChange({
      ...state,
      fields: has ? state.fields.filter((candidate) => candidate !== field) : [...state.fields, field],
    })
  }

  const addCustom = () => {
    const field = custom.trim()
    if (!field) return
    if (!state.fields.includes(field)) onChange({ ...state, fields: [...state.fields, field] })
    setCustom("")
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={state.mode}
          onValueChange={(value) => onChange({ ...state, mode: value as ProjectionMode })}
        >
          <SelectTrigger size="sm" className="w-60" aria-label={t("filter.projection")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("filter.proj.none")}</SelectItem>
            <SelectItem value="include">{t("filter.proj.include")}</SelectItem>
            <SelectItem value="exclude">{t("filter.proj.exclude")}</SelectItem>
          </SelectContent>
        </Select>
        {state.mode !== "none" ? (
          <>
            <Input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  addCustom()
                }
              }}
              placeholder={t("filter.proj.addField")}
              aria-label={t("filter.proj.addField")}
              spellCheck={false}
              className="h-8 w-44 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" onClick={addCustom} disabled={!custom.trim()}>
              <Plus /> {t("filter.proj.add")}
            </Button>
          </>
        ) : null}
      </div>

      {state.mode !== "none" ? (
        <div className="scrollbar-thin max-h-40 overflow-auto rounded-md border p-2">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {options.map((field) => (
              <label
                key={field}
                className="hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs"
              >
                <Checkbox
                  checked={state.fields.includes(field)}
                  onCheckedChange={() => toggle(field)}
                  aria-label={field}
                />
                <span className="truncate font-mono">{field}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {state.mode === "include" && state.fields.length > 0 && !state.fields.includes("_id") ? (
        <p className="text-muted-foreground text-xs">{t("filter.proj.idHint")}</p>
      ) : null}
    </div>
  )
}

interface ConditionRowProps {
  condition: ConditionNode
  fields: string[]
  onChange: (next: ConditionNode) => void
  onRemove: () => void
}

function ConditionRow({ condition, fields, onChange, onRemove }: ConditionRowProps) {
  const { t } = useI18n()
  const operator = operatorFor(condition.operator)
  const listId = `qb-fields-${condition.id}`

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

      {operator.kind === "boolean" ? (
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
      ) : (
        <Input
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          placeholder={operator.placeholder ?? t("filter.value")}
          aria-label={t("filter.value")}
          spellCheck={false}
          className="h-8 min-w-40 flex-1 font-mono text-xs"
        />
      )}

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

interface GroupEditorProps {
  group: GroupNode
  depth: number
  fields: string[]
  onChange: (next: GroupNode) => void
  onRemove?: () => void
}

function GroupEditor({ group, depth, fields, onChange, onRemove }: GroupEditorProps) {
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
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ) : (
            <GroupEditor
              key={child.id}
              group={child}
              depth={depth + 1}
              fields={fields}
              onChange={(next) => replaceChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </div>
    </div>
  )
}

export interface MongoQueryBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Field names offered for autocomplete, e.g. the visible columns. */
  fields?: string[]
  /** Current filter JSON used to seed the builder when it opens. */
  value: string
  /** Current projection JSON used to seed the builder when it opens. */
  projection?: string
  /** Called with the compiled filter and projection JSON when the user applies. */
  onApply: (filter: string, projection: string) => void
}

export function MongoQueryBuilder({
  open,
  onOpenChange,
  fields = [],
  value,
  projection = "",
  onApply,
}: MongoQueryBuilderProps) {
  const { t } = useI18n()
  const [root, setRoot] = React.useState<GroupNode>(() => parseFilter(value))
  const [projectionState, setProjectionState] = React.useState<ProjectionState>(() =>
    parseProjection(projection),
  )

  // Re-seed from the JSON editors every time the dialog opens, so the views
  // never drift apart.
  React.useEffect(() => {
    if (open) {
      setRoot(parseFilter(value))
      setProjectionState(parseProjection(projection))
    }
  }, [open, value, projection])

  const preview = React.useMemo(() => {
    const parts = [`${t("filter.conditions")}:\n${JSON.stringify(buildFilter(root), null, 2)}`]
    const projectionJson = buildProjection(projectionState)
    if (projectionJson) {
      parts.push(`${t("filter.columns")}:\n${JSON.stringify(JSON.parse(projectionJson), null, 2)}`)
    }
    return parts.join("\n\n")
  }, [root, projectionState, t])

  const apply = () => {
    onApply(JSON.stringify(buildFilter(root)), buildProjection(projectionState))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("filter.builderTitle")}</DialogTitle>
          <DialogDescription>{t("filter.builderDesc")}</DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[55vh] space-y-4 overflow-auto pr-1">
          <section className="space-y-2">
            <h4 className="text-xs font-medium">{t("filter.conditions")}</h4>
            <GroupEditor group={root} depth={0} fields={fields} onChange={setRoot} />
          </section>
          <section className="space-y-2">
            <h4 className="text-xs font-medium">{t("filter.columns")}</h4>
            <ProjectionEditor
              state={projectionState}
              knownFields={fields}
              onChange={setProjectionState}
            />
          </section>
        </div>

        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">{t("filter.preview")}</p>
          <pre className="bg-muted/40 scrollbar-thin max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
            {preview}
          </pre>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => {
              setRoot(emptyRoot())
              setProjectionState({ mode: "none", fields: [] })
            }}
          >
            {t("filter.clearAll")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={apply}>{t("filter.apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
