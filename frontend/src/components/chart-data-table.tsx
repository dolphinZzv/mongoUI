import { formatChartValue, type ChartConfig, type ChartSeries } from "@/lib/chart"

export interface ChartDataTableProps {
  config: ChartConfig
  categories: string[]
  series: ChartSeries[]
}

export function ChartDataTable({ config, categories, series }: ChartDataTableProps) {
  return (
    <div className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="px-2 py-1 text-left font-medium">{config.x || "—"}</th>
            {series.map((item) => (
              <th key={item.name} className="px-2 py-1 text-right font-medium">
                {item.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={`${category}-${index}`} className="border-t">
              <td className="max-w-[18rem] truncate px-2 py-1" title={category}>
                {category}
              </td>
              {series.map((item) => (
                <td key={item.name} className="px-2 py-1 text-right font-mono">
                  {formatChartValue(item.values[index] ?? 0, config)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
