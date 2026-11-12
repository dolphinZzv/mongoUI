import type * as React from "react"

import {
  CHART_COLORS,
  formatChartValue,
  type ChartConfig,
  type ChartData,
  type ChartSeries,
  type Scale,
  type ScatterPoint,
} from "@/lib/chart"

export interface ChartTooltipRow {
  name: string
  value: number
  display?: string
  color?: string
}

export interface ChartRendererContext {
  config: ChartConfig
  data: ChartData
  series: ChartSeries[]
  margin: { top: number; right: number; bottom: number; left: number }
  plotWidth: number
  plotHeight: number
  scale: Scale
  yFor: (value: number) => number
  xForValue: (value: number) => number
  rightScale: Scale
  yForRight: (value: number) => number
  formatTick: (tick: number) => string
  stacked: boolean
  percentStacked: boolean
  comboBar: ChartSeries[]
  comboLines: ChartSeries[]
  scatter: { points: ScatterPoint[]; xField: string; yField: string } | null
  scatterGroups: string[]
  scatterBounds: { x: Scale; y: Scale }
  scatterX: (value: number) => number
  scatterY: (value: number) => number
  showTooltip: (
    event: React.MouseEvent | React.PointerEvent,
    title: string,
    rows: ChartTooltipRow[],
  ) => void
  hideTooltip: () => void
  categoryTooltip: (
    event: React.MouseEvent | React.PointerEvent,
    category: string,
    index: number,
  ) => void
  drill: (index: number) => void
  drillValue: (field: string, value: number) => void
}

/** Builds the SVG pieces for the active chart type from the plot geometry. */
export function createChartRenderers(ctx: ChartRendererContext) {
  const {
    config,
    data,
    series,
    margin,
    plotWidth,
    plotHeight,
    scale,
    yFor,
    xForValue,
    rightScale,
    yForRight,
    formatTick,
    stacked,
    percentStacked,
    comboBar,
    comboLines,
    scatter,
    scatterGroups,
    scatterBounds,
    scatterX,
    scatterY,
    showTooltip,
    hideTooltip,
    categoryTooltip,
    drill,
    drillValue,
  } = ctx

const axes = () => (
  <g>
    {scale.ticks.map((tick) => {
      const y = yFor(tick)
      return (
        <g key={tick}>
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={y}
            y2={y}
            className="stroke-border"
            strokeDasharray="3 3"
          />
          <text
            x={margin.left - 8}
            y={y + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {formatTick(tick)}
          </text>
        </g>
      )
    })}
    <line
      x1={margin.left}
      x2={margin.left + plotWidth}
      y1={yFor(0)}
      y2={yFor(0)}
      className="stroke-border"
    />
  </g>
)

const xLabels = () => {
  const band = plotWidth / Math.max(1, data.categories.length)
  const step = Math.max(1, Math.ceil((data.categories.length * 60) / plotWidth))
  const maxChars = Math.max(6, Math.floor(band / 6))
  return (
    <g>
      {data.categories.map((category, index) => {
        if (index % step !== 0) return null
        const x = margin.left + (index + 0.5) * band
        return (
          <text
            key={index}
            x={x}
            y={margin.top + plotHeight + 14}
            textAnchor="end"
            transform={`rotate(-35, ${x}, ${margin.top + plotHeight + 14})`}
            className="fill-muted-foreground text-[10px]"
          >
            {category.length > maxChars ? `${category.slice(0, maxChars - 1)}…` : category}
          </text>
        )
      })}
    </g>
  )
}

const bars = () => {
  const band = plotWidth / Math.max(1, data.categories.length)
  const count = series.length
  const groupPad = band * 0.18
  const groupWidth = Math.max(1, band - groupPad * 2)
  const barWidth = groupWidth / Math.max(1, count)
  const baseline = yFor(0)

  if (stacked) {
    return (
      <g>
        {data.categories.map((category, ci) => {
          const total = series.reduce(
            (sum, item) => sum + Math.max(0, item.values[ci] ?? 0),
            0,
          )
          let offset = 0
          return series.map((item, si) => {
            const raw = Math.max(0, item.values[ci] ?? 0)
            const value = percentStacked ? (total > 0 ? raw / total : 0) : raw
            const top = yFor(offset + value)
            const bottom = yFor(offset)
            offset += value
            return (
              <rect
                key={`${ci}-${si}`}
                x={margin.left + ci * band + groupPad}
                y={top}
                width={Math.max(1, groupWidth)}
                height={Math.max(0, bottom - top)}
                fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseMove={(event) =>
                  showTooltip(
                    event,
                    category,
                    series.map((entry) => ({
                      name: entry.name,
                      value: entry.values[ci] ?? 0,
                    })),
                  )
                }
                onMouseLeave={hideTooltip}
                onPointerDown={(event) => categoryTooltip(event, category, ci)}
                onClick={() => drill(ci)}
              />
            )
          })
        })}
      </g>
    )
  }

  return (
    <g>
      {data.categories.map((category, ci) =>
        series.map((item, si) => {
          const value = item.values[ci] ?? 0
          const x = margin.left + ci * band + groupPad + si * barWidth
          const y = value >= 0 ? yFor(value) : baseline
          const h = Math.max(0, Math.abs(yFor(value) - baseline))
          const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
          return (
            <g key={`${ci}-${si}`}>
              <rect
                x={x}
                y={y}
                width={Math.max(1, barWidth - (count > 1 ? 1.5 : 2))}
                height={h}
                fill={color}
                rx={2}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseMove={(event) =>
                  showTooltip(
                    event,
                    category,
                    series.map((entry) => ({
                      name: entry.name,
                      value: entry.values[ci] ?? 0,
                    })),
                  )
                }
                onMouseLeave={hideTooltip}
                onPointerDown={(event) => categoryTooltip(event, category, ci)}
                onClick={() => drill(ci)}
              />
              {config.showValues && barWidth > 22 && h > 12 ? (
                <text
                  x={x + Math.max(1, barWidth) / 2}
                  y={Math.min(y, baseline) - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {formatChartValue(value, config)}
                </text>
              ) : null}
            </g>
          )
        }),
      )}
    </g>
  )
}

const hBars = () => {
  const band = plotHeight / Math.max(1, data.categories.length)
  const count = series.length
  const groupPad = band * 0.18
  const groupHeight = Math.max(1, band - groupPad * 2)
  const barHeight = groupHeight / Math.max(1, count)
  const baseline = xForValue(0)

  return (
    <g>
      {data.categories.map((category, ci) =>
        series.map((item, si) => {
          const value = item.values[ci] ?? 0
          const y = margin.top + ci * band + groupPad + si * barHeight
          const x = value >= 0 ? xForValue(value) : baseline
          const w = Math.max(0, Math.abs(xForValue(value) - baseline))
          const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
          return (
            <g key={`${ci}-${si}`}>
              <rect
                x={Math.min(x, baseline)}
                y={y}
                width={w}
                height={Math.max(1, barHeight - (count > 1 ? 1.5 : 2))}
                fill={color}
                rx={2}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseMove={(event) =>
                  showTooltip(
                    event,
                    category,
                    series.map((entry) => ({
                      name: entry.name,
                      value: entry.values[ci] ?? 0,
                    })),
                  )
                }
                onMouseLeave={hideTooltip}
                onPointerDown={(event) => categoryTooltip(event, category, ci)}
                onClick={() => drill(ci)}
              />
              {config.showValues && w > 30 ? (
                <text
                  x={Math.min(x, baseline) + w + 4}
                  y={y + barHeight / 2 + 3}
                  className="fill-muted-foreground text-[9px]"
                >
                  {formatChartValue(value, config)}
                </text>
              ) : null}
            </g>
          )
        }),
      )}
    </g>
  )
}

const linePath = (values: number[]) => {
  const band = plotWidth / Math.max(1, data.categories.length)
  return values
    .map((value, index) => {
      const x = margin.left + (index + 0.5) * band
      return `${index === 0 ? "M" : "L"}${x},${yFor(value)}`
    })
    .join(" ")
}

const lines = (area: boolean) => {
  const band = plotWidth / Math.max(1, data.categories.length)
  const baseline = yFor(0)
  return (
    <g>
      {area
        ? series.map((item, si) => (
            <path
              key={`area-${si}`}
              d={`${linePath(item.values)} L${margin.left + data.categories.length * band},${baseline} L${margin.left},${baseline} Z`}
              fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
              opacity={0.18}
            />
          ))
        : null}
      {series.map((item, si) => (
        <path
          key={`line-${si}`}
          d={linePath(item.values)}
          fill="none"
          stroke={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {series.map((item, si) =>
        item.values.map((value, index) => (
          <circle
            key={`dot-${si}-${index}`}
            cx={margin.left + (index + 0.5) * band}
            cy={yFor(value)}
            r={3}
            fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
            className="cursor-pointer hover:opacity-80"
            onMouseMove={(event) =>
              showTooltip(
                event,
                data.categories[index],
                series.map((entry) => ({
                  name: entry.name,
                  value: entry.values[index] ?? 0,
                })),
              )
            }
            onMouseLeave={hideTooltip}
            onPointerDown={(event) => categoryTooltip(event, data.categories[index], index)}
            onClick={() => drill(index)}
          />
        )),
      )}
    </g>
  )
}

const combo = () => {
  const band = plotWidth / Math.max(1, data.categories.length)
  const barWidth = Math.max(1, band * 0.46)
  const baseline = yFor(0)
  const bar = comboBar[0]
  return (
    <g>
      {bar
        ? data.categories.map((category, index) => {
            const value = bar.values[index] ?? 0
            const y = value >= 0 ? yFor(value) : baseline
            const h = Math.abs(yFor(value) - baseline)
            const color = CHART_COLORS[data.series.indexOf(bar) % CHART_COLORS.length]
            return (
              <g key={`combo-bar-${index}`}>
                <rect
                  x={margin.left + index * band + (band - barWidth) / 2}
                  y={y}
                  width={barWidth}
                  height={h}
                  fill={color}
                  rx={2}
                  className="cursor-pointer hover:opacity-80"
                  onMouseMove={(event) => categoryTooltip(event, category, index)}
                  onMouseLeave={hideTooltip}
                  onPointerDown={(event) => categoryTooltip(event, category, index)}
                  onClick={() => drill(index)}
                />
                {config.showValues && barWidth > 22 && h > 12 ? (
                  <text
                    x={margin.left + index * band + band / 2}
                    y={Math.min(y, baseline) - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {formatChartValue(value, config)}
                  </text>
                ) : null}
              </g>
            )
          })
        : null}
      {comboLines.map((item) => {
        const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
        return (
          <g key={`combo-line-${item.name}`}>
            <path
              d={item.values
                .map(
                  (value, index) =>
                    `${index === 0 ? "M" : "L"}${margin.left + (index + 0.5) * band},${yForRight(value)}`,
                )
                .join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {item.values.map((value, index) => (
              <circle
                key={`combo-dot-${index}`}
                cx={margin.left + (index + 0.5) * band}
                cy={yForRight(value)}
                r={3}
                fill={color}
                className="cursor-pointer hover:opacity-80"
                onMouseMove={(event) =>
                  categoryTooltip(event, data.categories[index], index)
                }
                onMouseLeave={hideTooltip}
                onPointerDown={(event) =>
                  categoryTooltip(event, data.categories[index], index)
                }
                onClick={() => drill(index)}
              />
            ))}
          </g>
        )
      })}
    </g>
  )
}

const rightAxis = () => (
  <g>
    {rightScale.ticks.map((tick) => (
      <text
        key={`right-${tick}`}
        x={margin.left + plotWidth + 8}
        y={yForRight(tick) + 3}
        textAnchor="start"
        className="fill-muted-foreground text-[10px]"
      >
        {formatTick(tick)}
      </text>
    ))}
  </g>
)

const pie = () => {
  // A pie needs one measure; multiple value fields would be summed, which is
  // easy to misread, so only the first visible series is used.
  const measure = series[0]
  if (!measure) return null
  const totals = data.categories.map((_, index) => Math.max(0, measure.values[index] ?? 0))
  const total = totals.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const cx = margin.left + plotWidth / 2
  const cy = margin.top + plotHeight / 2
  const radius = Math.max(20, Math.min(plotWidth, plotHeight) / 2 - 8)
  let angle = -Math.PI / 2

  return (
    <g>
      {data.categories.map((category, index) => {
        const fraction = totals[index] / total
        const start = angle
        const end = angle + fraction * Math.PI * 2
        angle = end
        const large = end - start > Math.PI ? 1 : 0
        const x1 = cx + radius * Math.cos(start)
        const y1 = cy + radius * Math.sin(start)
        const x2 = cx + radius * Math.cos(end)
        const y2 = cy + radius * Math.sin(end)
        const d = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`
        const mid = (start + end) / 2
        const labelX = cx + radius * 0.68 * Math.cos(mid)
        const labelY = cy + radius * 0.68 * Math.sin(mid)
        return (
          <g key={index}>
            <path
              d={d}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              stroke="var(--background)"
              strokeWidth={1}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseMove={(event) => {
                const percent = total > 0 ? ((totals[index] / total) * 100).toFixed(1) : "0.0"
                showTooltip(event, category, [
                  {
                    name: measure.name,
                    value: totals[index],
                    display: `${formatChartValue(totals[index], config)} (${percent}%)`,
                    color: CHART_COLORS[index % CHART_COLORS.length],
                  },
                ])
              }}
              onMouseLeave={hideTooltip}
              onClick={() => drill(index)}
              onPointerDown={(event) => {
                const percent = total > 0 ? ((totals[index] / total) * 100).toFixed(1) : "0.0"
                showTooltip(event, category, [
                  {
                    name: measure.name,
                    value: totals[index],
                    display: `${formatChartValue(totals[index], config)} (${percent}%)`,
                    color: CHART_COLORS[index % CHART_COLORS.length],
                  },
                ])
              }}
            />
            {config.showValues && fraction >= 0.05 ? (
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                className="fill-background text-[10px] font-medium"
              >
                {(fraction * 100).toFixed(0)}%
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

const scatterAxes = () => (
  <g>
    {scatterBounds.y.ticks.map((tick) => (
      <g key={`y-${tick}`}>
        <line
          x1={margin.left}
          x2={margin.left + plotWidth}
          y1={scatterY(tick)}
          y2={scatterY(tick)}
          className="stroke-border"
          strokeDasharray="3 3"
        />
        <text
          x={margin.left - 8}
          y={scatterY(tick) + 3}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {formatTick(tick)}
        </text>
      </g>
    ))}
    {scatterBounds.x.ticks.map((tick) => (
      <g key={`x-${tick}`}>
        <line
          x1={scatterX(tick)}
          x2={scatterX(tick)}
          y1={margin.top}
          y2={margin.top + plotHeight}
          className="stroke-border"
          strokeDasharray="3 3"
        />
        <text
          x={scatterX(tick)}
          y={margin.top + plotHeight + 14}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {formatTick(tick)}
        </text>
      </g>
    ))}
  </g>
)

const scatterPoints = () => {
  if (!scatter) return null
  return (
    <g>
      {scatter.points.map((point: ScatterPoint, index) => {
        const groupIndex = point.group ? scatterGroups.indexOf(point.group) : 0
        return (
          <circle
            key={index}
            cx={scatterX(point.x)}
            cy={scatterY(point.y)}
            r={4}
            fill={CHART_COLORS[groupIndex % CHART_COLORS.length]}
            opacity={0.7}
            className="cursor-pointer hover:opacity-100"
            onMouseMove={(event) =>
              showTooltip(event, point.label, [
                {
                  name: scatter.xField,
                  value: point.x,
                  display: formatChartValue(point.x, config),
                  color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                },
                {
                  name: scatter.yField,
                  value: point.y,
                  display: formatChartValue(point.y, config),
                  color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                },
              ])
            }
            onMouseLeave={hideTooltip}
            onClick={() => drillValue(scatter.xField, point.x)}
            onPointerDown={(event) =>
              showTooltip(event, point.label, [
                {
                  name: scatter.xField,
                  value: point.x,
                  display: formatChartValue(point.x, config),
                  color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                },
                {
                  name: scatter.yField,
                  value: point.y,
                  display: formatChartValue(point.y, config),
                  color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                },
              ])
            }
          />
        )
      })}
    </g>
  )
}

  return {
    axes,
    xLabels,
    bars,
    hBars,
    lines,
    combo,
    rightAxis,
    pie,
    scatterAxes,
    scatterPoints,
  }
}
