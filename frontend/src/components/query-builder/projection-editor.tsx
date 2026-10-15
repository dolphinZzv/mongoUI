import * as React from "react"
import { Plus, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import type { ProjectionMode, ProjectionState } from "./model"

export interface ProjectionEditorProps {
  state: ProjectionState
  knownFields: string[]
  onChange: (next: ProjectionState) => void
}

export function ProjectionEditor({ state, knownFields, onChange }: ProjectionEditorProps) {
  const { t } = useI18n()
  const [custom, setCustom] = React.useState("")
  const [fieldQuery, setFieldQuery] = React.useState("")

  const options = React.useMemo(() => {
    const set = new Set<string>(["_id"])
    for (const field of knownFields) if (field) set.add(field)
    for (const field of state.fields) if (field) set.add(field)
    return Array.from(set).sort((a, b) =>
      a === "_id" ? -1 : b === "_id" ? 1 : a.localeCompare(b),
    )
  }, [knownFields, state.fields])

  const filteredOptions = React.useMemo(() => {
    const needle = fieldQuery.trim().toLowerCase()
    if (!needle) return options
    return options.filter((field) => field.toLowerCase().includes(needle))
  }, [options, fieldQuery])

  const toggle = (field: string) => {
    const has = state.fields.includes(field)
    onChange({
      ...state,
      fields: has ? state.fields.filter((candidate) => candidate !== field) : [...state.fields, field],
    })
  }

  const selectAll = () => onChange({ ...state, fields: options.slice() })
  const invert = () =>
    onChange({ ...state, fields: options.filter((field) => !state.fields.includes(field)) })
  const clearAll = () => onChange({ ...state, fields: [] })

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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={fieldQuery}
                onChange={(event) => setFieldQuery(event.target.value)}
                placeholder={t("docs.searchFields")}
                aria-label={t("docs.searchFields")}
                spellCheck={false}
                autoComplete="off"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <span className="text-muted-foreground text-[11px]">
              {t("docs.fieldsSelected", {
                selected: state.fields.length,
                total: options.length,
              })}
            </span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={selectAll}>
              {t("docs.selectAll")}
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={invert}>
              {t("docs.invertSelection")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={clearAll}>
              {t("common.clear")}
            </Button>
          </div>
          <div className="scrollbar-thin max-h-40 overflow-auto rounded-md border p-2">
            {filteredOptions.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-center text-xs">
                {t("docs.noFieldsMatch")}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {filteredOptions.map((field) => (
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
        </div>
      ) : null}

      {state.mode === "include" && state.fields.length > 0 && !state.fields.includes("_id") ? (
        <p className="text-muted-foreground text-xs">{t("filter.proj.idHint")}</p>
      ) : null}
    </div>
  )
}
