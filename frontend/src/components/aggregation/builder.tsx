import * as React from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Button } from "@/components/ui/button"
import { JsonEditor } from "@/components/json-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"

const STAGES = [
  "$match",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$project",
  "$unwind",
  "$lookup",
  "$addFields",
  "$count",
  "$sample",
  "$set",
  "$unset",
] as const

const DEFAULT_BODIES: Record<string, unknown> = {
  $match: {},
  $group: { _id: "$field", count: { $sum: 1 } },
  $sort: { _id: -1 },
  $limit: 20,
  $skip: 0,
  $project: { field: 1 },
  $unwind: "$field",
  $lookup: { from: "other", localField: "field", foreignField: "_id", as: "joined" },
  $addFields: { field: "$other" },
  $count: "count",
  $sample: { size: 20 },
  $set: { field: "$other" },
  $unset: "field",
}

function stageType(stage: unknown): string {
  if (!stage || typeof stage !== "object") return "$match"
  const key = Object.keys(stage as Record<string, unknown>)[0]
  return key && key.startsWith("$") ? key : "$match"
}

function stageBody(stage: unknown): unknown {
  if (!stage || typeof stage !== "object") return {}
  const record = stage as Record<string, unknown>
  const key = Object.keys(record)[0]
  return key ? record[key] : {}
}

function StageEditor({
  stage,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  stage: unknown
  index: number
  count: number
  onChange: (stage: unknown) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const type = stageType(stage)
  const [text, setText] = React.useState(() => JSON.stringify(stageBody(stage), null, 2))
  const lastType = React.useRef(type)
  const lastEmitted = React.useRef(JSON.stringify(stage))

  React.useEffect(() => {
    if (lastType.current === type) return
    lastType.current = type
    setText(JSON.stringify(stageBody(stage), null, 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const emit = (nextText: string) => {
    setText(nextText)
    try {
      const body = JSON.parse(nextText)
      const next = { [type]: body }
      lastEmitted.current = JSON.stringify(next)
      onChange(next)
    } catch {
      /* keep typing locally until the JSON is valid */
    }
  }

  React.useEffect(() => {
    const incoming = JSON.stringify(stage)
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    setText(JSON.stringify(stageBody(stage), null, 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const changeType = (nextType: string) => {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = DEFAULT_BODIES[nextType] ?? {}
    }
    onChange({ [nextType]: body })
  }

  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-muted text-muted-foreground flex size-5 items-center justify-center rounded-full text-[10px]">
          {index + 1}
        </span>
        <Select value={type} onValueChange={changeType}>
          <SelectTrigger size="sm" className="w-32 font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((stageName) => (
              <SelectItem key={stageName} value={stageName} className="font-mono">
                {stageName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={t("agg.moveUp")}
            title={t("agg.moveUp")}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={t("agg.moveDown")}
            title={t("agg.moveDown")}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={t("common.delete")}
            title={t("common.delete")}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <JsonEditor value={text} onChange={emit} rows={3} className="min-h-[4.5rem]" />
    </div>
  )
}

/** Stage-by-stage visual editor that stays in sync with the JSON pipeline. */
export function AggregationBuilder({
  pipeline,
  onChange,
}: {
  pipeline: string
  onChange: (pipeline: string) => void
}) {
  const { t } = useI18n()
  const stages = React.useMemo<unknown[] | null>(() => {
    try {
      const parsed = JSON.parse(pipeline.trim() || "[]")
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }, [pipeline])

  if (!stages) {
    return (
      <p className="text-destructive rounded-lg border p-3 text-xs">{t("agg.builderInvalid")}</p>
    )
  }

  const update = (next: unknown[]) => onChange(JSON.stringify(next, null, 2))

  return (
    <div className="space-y-2">
      {stages.map((stage, index) => (
        <StageEditor
          key={index}
          stage={stage}
          index={index}
          count={stages.length}
          onChange={(nextStage) => {
            const next = [...stages]
            next[index] = nextStage
            update(next)
          }}
          onMove={(delta) => {
            const target = index + delta
            if (target < 0 || target >= stages.length) return
            const next = [...stages]
            const [item] = next.splice(index, 1)
            next.splice(target, 0, item)
            update(next)
          }}
          onRemove={() => update(stages.filter((_, i) => i !== index))}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-40 justify-start">
            <Plus /> {t("agg.addStage")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {STAGES.map((stageName) => (
            <DropdownMenuItem
              key={stageName}
              className="font-mono"
              onSelect={() =>
                update([...stages, { [stageName]: DEFAULT_BODIES[stageName] ?? {} }])
              }
            >
              {stageName}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
