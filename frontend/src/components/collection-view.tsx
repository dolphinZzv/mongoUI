import { CheckIcon, CopyIcon, Table2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { copyToClipboard } from "@/lib/clipboard"
import { AggregationTab } from "@/components/aggregation-tab"
import { DocumentsTab } from "@/components/documents-tab"
import { IndexesTab } from "@/components/indexes-tab"
import { SchemaTab } from "@/components/schema-tab"
import { StatsTab } from "@/components/stats-tab"

interface CollectionViewProps {
  connectionId: string
  database: string
  collection: string
  readOnly: boolean
}

export function CollectionView({
  connectionId,
  database,
  collection,
  readOnly,
}: CollectionViewProps) {
  const [copied, setCopied] = React.useState(false)

  const copyPath = async () => {
    const ok = await copyToClipboard(`${database}.${collection}`)
    if (!ok) {
      toast.error("Copy failed — select the text and copy manually")
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
    toast.success("Collection path copied")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs defaultValue="documents" className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Table2 className="text-muted-foreground size-4" />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-muted-foreground truncate text-sm">{database}</span>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium">{collection}</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={copyPath} title="Copy path">
            {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
          </Button>
          <TabsList className="ml-auto">
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="aggregation">Aggregation</TabsTrigger>
            <TabsTrigger value="indexes">Indexes</TabsTrigger>
            <TabsTrigger value="schema">Schema</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="documents" className="min-h-0 flex-1">
          <DocumentsTab
            connectionId={connectionId}
            database={database}
            collection={collection}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="aggregation" className="min-h-0 flex-1">
          <AggregationTab
            connectionId={connectionId}
            database={database}
            collection={collection}
          />
        </TabsContent>
        <TabsContent value="indexes" className="min-h-0 flex-1">
          <IndexesTab
            connectionId={connectionId}
            database={database}
            collection={collection}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="schema" className="min-h-0 flex-1">
          <SchemaTab connectionId={connectionId} database={database} collection={collection} />
        </TabsContent>
        <TabsContent value="stats" className="min-h-0 flex-1">
          <StatsTab connectionId={connectionId} database={database} collection={collection} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
