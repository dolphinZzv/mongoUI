import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { JsonEditor } from "@/components/json-editor"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import type { IndexOptionsForm } from "./model"

interface OptionsEditorProps {
  value: IndexOptionsForm
  onChange: (patch: Partial<IndexOptionsForm>) => void
  hasTextKey: boolean
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
}

/** Name, flags, TTL and advanced (collation/weights/partial) index options. */
export function OptionsEditor({
  value,
  onChange,
  hasTextKey,
  advancedOpen,
  onAdvancedOpenChange,
}: OptionsEditorProps) {
  const { t } = useI18n()

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="index-name">{t("indexes.name")}</Label>
        <Input
          id="index-name"
          value={value.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t("indexes.namePlaceholder")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.unique}
            onCheckedChange={(checked) => onChange({ unique: Boolean(checked) })}
          />
          {t("indexes.unique")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.sparse}
            onCheckedChange={(checked) => onChange({ sparse: Boolean(checked) })}
          />
          {t("indexes.sparse")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.hidden}
            onCheckedChange={(checked) => onChange({ hidden: Boolean(checked) })}
          />
          {t("indexes.hidden")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={value.ttlEnabled}
            onCheckedChange={(checked) => onChange({ ttlEnabled: checked })}
          />
          {t("indexes.ttl")}
        </label>
      </div>

      {value.ttlEnabled ? (
        <div className="space-y-1">
          <Label htmlFor="index-ttl">{t("indexes.ttlSeconds")}</Label>
          <Input
            id="index-ttl"
            type="number"
            min={0}
            value={value.ttlSeconds}
            onChange={(event) => onChange({ ttlSeconds: event.target.value })}
            className="w-40"
          />
        </div>
      ) : null}

      <Collapsible open={advancedOpen} onOpenChange={onAdvancedOpenChange}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-0">
            <ChevronDown
              className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
            {t("indexes.advanced")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label>{t("indexes.partialFilter")}</Label>
            <JsonEditor
              value={value.partialFilter}
              onChange={(next) => onChange({ partialFilter: next })}
              rows={3}
              placeholder='{ "status": "active" }'
            />
          </div>
          <div className="space-y-1">
            <Label>{t("indexes.collation")}</Label>
            <JsonEditor
              value={value.collation}
              onChange={(next) => onChange({ collation: next })}
              rows={3}
              placeholder='{ "locale": "en", "strength": 2 }'
            />
          </div>
          {hasTextKey ? (
            <>
              <div className="space-y-1">
                <Label>{t("indexes.weights")}</Label>
                <JsonEditor
                  value={value.weights}
                  onChange={(next) => onChange({ weights: next })}
                  rows={3}
                  placeholder='{ "title": 10, "body": 1 }'
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("indexes.defaultLanguage")}</Label>
                  <Input
                    value={value.defaultLanguage}
                    onChange={(event) => onChange({ defaultLanguage: event.target.value })}
                    placeholder="english"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("indexes.languageOverride")}</Label>
                  <Input
                    value={value.languageOverride}
                    onChange={(event) => onChange({ languageOverride: event.target.value })}
                    placeholder="language"
                  />
                </div>
              </div>
            </>
          ) : null}
          <div className="space-y-1">
            <Label>{t("indexes.wildcardProjection")}</Label>
            <JsonEditor
              value={value.wildcardProjection}
              onChange={(next) => onChange({ wildcardProjection: next })}
              rows={3}
              placeholder='{ "field": 1 }'
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
