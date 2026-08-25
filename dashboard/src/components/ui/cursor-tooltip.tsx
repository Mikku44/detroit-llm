import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const OFFSET = 12
const DURATION = 150

export function CursorTooltip({
  content,
  containerClassName,
  children,
}: {
  content: (data: Record<string, string>) => React.ReactNode
  containerClassName?: string
  children: React.ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [data, setData] = useState<Record<string, string> | null>(null)
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (!pos) return
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [pos])

  const place = (clientX: number, clientY: number) => {
    const el = contentRef.current
    let x = clientX + OFFSET
    let y = clientY + OFFSET
    if (el) {
      const { width, height } = el.getBoundingClientRect()
      if (x + width > window.innerWidth) x = clientX - width - OFFSET
      if (y + height > window.innerHeight) y = clientY - height - OFFSET
    }
    setPos({ x: Math.max(0, x), y: Math.max(0, y) })
  }

  const hide = () => {
    setPos(null)
    setData(null)
    setAnimate(false)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null
    if (!target) {
      hide()
      return
    }
    const values: Record<string, string> = {}
    for (const attr of Array.from(target.attributes)) {
      if (attr.name.startsWith('data-tip-')) {
        values[attr.name.slice('data-tip-'.length)] = attr.value
      }
    }
    setData(values)
    place(e.clientX, e.clientY)
  }

  const handleMouseLeave = () => {
    hide()
  }

  return (
    <div className={containerClassName} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      {children}
      {createPortal(
        <div
          ref={contentRef}
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{
            transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : 'translate(0px, 0px)',
            opacity: pos ? 1 : 0,
            transition: animate ? `transform ${DURATION}ms ease-out, opacity ${DURATION}ms ease-out` : 'none',
          }}
        >
          <div className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs text-zinc-950 shadow-lg">
            {data ? content(data) : null}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
