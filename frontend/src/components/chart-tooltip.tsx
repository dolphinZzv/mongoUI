export interface ChartTooltipState {
  x: number
  y: number
  title: string
  rows: { name: string; value: string; color: string }[]
}

export interface ChartTooltipProps {
  tooltip: ChartTooltipState
  chartWidth: number
}

export function ChartTooltip({ tooltip, chartWidth }: ChartTooltipProps) {
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none absolute z-20 min-w-[8rem] rounded-md border p-2 text-xs shadow-md"
      style={{
        left: Math.min(tooltip.x + 12, Math.max(0, chartWidth - 180)),
        top: Math.max(0, tooltip.y - 8),
      }}
    >
      <div className="mb-1 max-w-[16rem] truncate font-medium" title={tooltip.title}>
        {tooltip.title}
      </div>
      {tooltip.rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: row.color }}
            />
            <span className="text-muted-foreground max-w-[9rem] truncate">{row.name}</span>
          </span>
          <span className="font-mono">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
