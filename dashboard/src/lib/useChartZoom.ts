import { useCallback, useEffect, useRef, useState } from 'react'

export function useChartZoom(dataLength: number) {
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; startIdx: number; span: number } | null>(null)

  const ref = useCallback((node: HTMLDivElement | null) => {
    setEl(node)
  }, [])

  const validRange =
    zoomRange && dataLength > 0 && zoomRange[0] >= 0 && zoomRange[1] < dataLength ? zoomRange : null

  useEffect(() => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoomRange((prev) => {
        const total = dataLength
        if (total < 2) return prev
        const [start, end] = prev ?? [0, total - 1]
        const span = end - start + 1
        const factor = e.deltaY > 0 ? 1.3 : 0.75
        const newSpan = Math.max(2, Math.min(total, Math.round(span * factor)))
        const rect = el.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        const centerIdx = start + ratio * (span - 1)
        let newStart = Math.round(centerIdx - ratio * (newSpan - 1))
        newStart = Math.max(0, Math.min(newStart, total - newSpan))
        return [newStart, newStart + newSpan - 1]
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el, dataLength])

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!validRange || !el) return
    dragRef.current = { x: e.clientX, startIdx: validRange[0], span: validRange[1] - validRange[0] + 1 }
  }
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || !el) return
    const pxPerIdx = el.getBoundingClientRect().width / d.span
    const delta = Math.round((e.clientX - d.x) / pxPerIdx)
    const newStart = Math.max(0, Math.min(d.startIdx - delta, Math.max(0, dataLength - d.span)))
    setZoomRange([newStart, newStart + d.span - 1])
  }
  const onMouseUp = () => {
    dragRef.current = null
  }
  const reset = () => setZoomRange(null)

  return { ref, range: validRange, onMouseDown, onMouseMove, onMouseUp, reset }
}
