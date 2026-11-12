import * as React from "react"

import type { ColumnDropPosition } from "@/lib/columnPrefs"

interface ColumnDropTarget {
  column: string
  position: ColumnDropPosition
}

interface UseColumnDragOptions {
  canDrop: (source: string, target: string) => boolean
  onDrop: (source: string, target: string, position: ColumnDropPosition) => void
}

/**
 * HTML5 drag-and-drop for table headers. The hook keeps the dragged column and
 * the current drop indicator, and returns props to spread onto each header.
 */
export function useColumnDrag({ canDrop, onDrop }: UseColumnDragOptions) {
  const [source, setSource] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<ColumnDropTarget | null>(null)
  const sourceRef = React.useRef<string | null>(null)
  const blockedRef = React.useRef(false)

  const end = React.useCallback(() => {
    sourceRef.current = null
    blockedRef.current = false
    setSource(null)
    setDropTarget(null)
  }, [])

  const headerProps = React.useCallback(
    (column: string) => ({
      draggable: true,
      onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
        // Resizing starts on the separator; do not turn that gesture into a drag.
        blockedRef.current = Boolean(
          (event.target as HTMLElement).closest("[data-column-resize]"),
        )
      },
      onDragStart: (event: React.DragEvent<HTMLElement>) => {
        if (blockedRef.current) {
          event.preventDefault()
          return
        }
        sourceRef.current = column
        setSource(column)
        setDropTarget(null)
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", column)
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        const active = sourceRef.current
        if (!active || !canDrop(active, column)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        const rect = event.currentTarget.getBoundingClientRect()
        const position: ColumnDropPosition =
          event.clientX < rect.left + rect.width / 2 ? "before" : "after"
        setDropTarget((prev) =>
          prev?.column === column && prev.position === position
            ? prev
            : { column, position },
        )
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropTarget((prev) => (prev?.column === column ? null : prev))
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        const active = sourceRef.current ?? event.dataTransfer.getData("text/plain")
        const rect = event.currentTarget.getBoundingClientRect()
        const position: ColumnDropPosition =
          event.clientX < rect.left + rect.width / 2 ? "before" : "after"
        end()
        if (!active || !canDrop(active, column)) return
        onDrop(active, column, position)
      },
      onDragEnd: end,
    }),
    [canDrop, end, onDrop],
  )

  return { dragSource: source, dropTarget, headerProps }
}
