"use client"
import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { motion, useMotionValue, useReducedMotion } from "motion/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Sparkles, Bell, ArrowUpRight, Image as ImageIcon, ThumbsUp, Trophy, ChevronUp, ChevronDown } from "lucide-react"
import AgentAvatar from "@/components/smoothui/agent-avatar"

export interface UpdateItem {
  id: string
  title: string
  description: string
  tag: string
  date: string
  image: string
  href?: string
  icon?: React.ElementType
}

export const whatsNewItems: UpdateItem[] = [
  {
    id: "6",
    title: "Models Ranking — Compare Top Models",
    description: "จัดอันดับโมเดลยอดนิยมตามการใช้งานจริง ดูคะแนนและเลือกโมเดลที่เหมาะกับงานคุณได้ที่หน้า Models",
    tag: "NEW",
    date: "Sep 2, 2026",
    image: "/whatsnew/model-ranking.png",
    href: "/models",
    icon: Trophy,
  },
  {
    id: "5",
    title: "Like / Dislike ข้อความแชต",
    description: "กด Like / Dislike ให้ทุกข้อความในแชตได้แล้ว เพื่อช่วยปรับคุณภาพโมเดลและบันทึก feedback",
    tag: "CHAT",
    date: "Sep 1, 2026",
    image: "/whatsnew/like-button.png",
    href: "/chat",
    icon: ThumbsUp,
  },
  {
    id: "4",
    title: "โมเดลใหม่: GLM-5.3 + GLM-Image",
    description: "เพิ่ม glm-5.3 (reasoning flagship 1M context) และ glm-image / cogview-4 / cogview-4-250304 สร้างรูป 1024x1024 ผ่าน Z.AI",
    tag: "MODELS",
    date: "Sep 1, 2026",
    image: "/whatsnew/newmodel.png",
    href: "/models",
    icon: ImageIcon,
  },
]

const SCROLL_TIMEOUT_OFFSET = 100
const MIN_SCROLL_INTERVAL = 300
const SCROLL_THRESHOLD = 20
const SCALE_FACTOR = 0.08
const MIN_SCALE = 0.08
const MAX_SCALE = 2
const HOVER_SCALE_MULTIPLIER = 1.02

function WhatsNewStack({ items, cardHeight = 360, className }: { items: UpdateItem[]; cardHeight?: number; className?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollY = useMotionValue(0)
  const lastScrollTime = useRef(0)
  const shouldReduceMotion = useReducedMotion()
  const totalItems = items.length
  const maxIndex = totalItems - 1
  const FRAME_OFFSET = -28
  const FRAMES_VISIBLE_LENGTH = 3
  const SNAP_DISTANCE = 50
  const CARD_PADDING = 96

  const clamp = useCallback((val: number, [min, max]: [number, number]) => Math.min(Math.max(val, min), max), [])

  const scrollToCard = useCallback((direction: 1 | -1) => {
    if (isScrolling) return
    const now = Date.now()
    if (now - lastScrollTime.current < MIN_SCROLL_INTERVAL) return
    const newIndex = clamp(currentIndex + direction, [0, maxIndex])
    if (newIndex !== currentIndex) {
      lastScrollTime.current = now
      setIsScrolling(true)
      setCurrentIndex(newIndex)
      scrollY.set(newIndex * SNAP_DISTANCE)
      setTimeout(() => setIsScrolling(false), 180 + SCROLL_TIMEOUT_OFFSET)
    }
  }, [currentIndex, maxIndex, scrollY, isScrolling, clamp])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isScrolling) return
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); scrollToCard(-1) }
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); scrollToCard(1) }
    else if (e.key === "Home") { e.preventDefault(); if (currentIndex !== 0) { setIsScrolling(true); setCurrentIndex(0); scrollY.set(0); setTimeout(() => setIsScrolling(false), 280) } }
    else if (e.key === "End") { e.preventDefault(); if (currentIndex !== maxIndex) { setIsScrolling(true); setCurrentIndex(maxIndex); scrollY.set(maxIndex * SNAP_DISTANCE); setTimeout(() => setIsScrolling(false), 280) } }
  }, [currentIndex, maxIndex, scrollY, isScrolling, scrollToCard])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    if (isScrolling) return
    if (Math.abs(e.deltaY) < SCROLL_THRESHOLD) return
    scrollToCard(e.deltaY > 0 ? 1 : -1)
  }, [isScrolling, scrollToCard])

  useEffect(() => { scrollY.set(currentIndex * SNAP_DISTANCE) }, [currentIndex, scrollY])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    c.addEventListener("wheel", handleWheel, { passive: false })
    return () => c.removeEventListener("wheel", handleWheel)
  }, [handleWheel])

  const getCardTransform = useCallback((index: number) => {
    const offsetIndex = index - currentIndex
    const isBehindCurrent = currentIndex > index
    const blur = !shouldReduceMotion && isBehindCurrent ? 2 : 0
    const opacity = currentIndex > index ? 0 : 1
    const scale = shouldReduceMotion ? 1 : clamp(1 - offsetIndex * SCALE_FACTOR, [MIN_SCALE, MAX_SCALE])
    const y = shouldReduceMotion ? 0 : clamp(offsetIndex * FRAME_OFFSET, [FRAME_OFFSET * FRAMES_VISIBLE_LENGTH, Number.POSITIVE_INFINITY])
    const zIndex = items.length - index
    return { blur, opacity, scale, y, zIndex }
  }, [currentIndex, items.length, clamp, shouldReduceMotion])

  return (
    <section aria-label="What's new card stack" className={cn("relative mx-auto h-fit w-fit min-w-[300px] max-w-full", className)}>
      <div
        ref={containerRef}
        role="application"
        tabIndex={0}
        aria-label="Scrollable what's new container"
        onKeyDown={handleKeyDown}
        className="relative h-full w-full outline-none select-none"
        style={{ minHeight: `${cardHeight + CARD_PADDING}px`, perspective: "1000px", perspectiveOrigin: "center 60%", touchAction: "none" }}
      >
        <button
          aria-label="Previous update"
          onClick={() => scrollToCard(-1)}
          disabled={currentIndex === 0 || isScrolling}
          className="absolute top-2 left-1/2 z-30 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/90 p-1.5 text-zinc-300 shadow-lg backdrop-blur hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronUp size={14} />
        </button>
        <button
          aria-label="Next update"
          onClick={() => scrollToCard(1)}
          disabled={currentIndex === maxIndex || isScrolling}
          className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/90 p-1.5 text-zinc-300 shadow-lg backdrop-blur hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronDown size={14} />
        </button>
        {items.map((item, i) => {
          const t = getCardTransform(i)
          const isActive = i === currentIndex
          const isHovered = hoveredIndex === i
          const Icon = item.icon || Sparkles
          return (
            <motion.div
              key={item.id}
              aria-hidden={!isActive}
              data-active={isActive}
              initial={false}
              animate={shouldReduceMotion ? { x: "-50%" } : { scale: t.scale, x: "-50%", y: `calc(-50% + ${t.y}px)` }}
              transition={shouldReduceMotion ? { duration: 0 } : { damping: 20, duration: 0.25, mass: 0.5, stiffness: 250, type: "spring" as const }}
              whileHover={shouldReduceMotion || !isActive ? {} : { scale: t.scale * HOVER_SCALE_MULTIPLIER, transition: { damping: 20, duration: 0.25, mass: 0.5, stiffness: 250, type: "spring" as const } }}
              onMouseEnter={() => isActive && setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => isActive && setHoveredIndex(i)}
              onBlur={() => setHoveredIndex(null)}
              tabIndex={isActive ? 0 : -1}
              className="absolute top-1/2 left-1/2 w-[340px] max-w-[92vw] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl"
              style={{
                borderWidth: `${2 / t.scale}px`,
                filter: `blur(${t.blur}px)`,
                height: `${cardHeight}px`,
                opacity: t.opacity,
                pointerEvents: isActive ? "auto" : "none",
                transformOrigin: "center",
                transitionDuration: shouldReduceMotion ? "0ms" : "200ms",
                transitionProperty: shouldReduceMotion ? "none" : "opacity, filter",
                zIndex: t.zIndex,
              }}
            >
              <div className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl bg-zinc-900 transition-all", isHovered && "shadow-2xl")} style={{ height: `${cardHeight}px` }}>
                {isScrolling && isActive && <div className="absolute -top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-[var(--primary-color)] opacity-75" />}
                <div className="relative w-full flex-1 overflow-hidden bg-zinc-800">
                  <img alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-60" src={item.image} style={{ filter: "blur(24px)", scale: "1.2", pointerEvents: "none" }} />
                  <img alt={item.title} className="absolute inset-0 h-full w-full object-cover" src={item.image} draggable={false} style={{ pointerEvents: "none" }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/20 to-transparent" />
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <span className="rounded-full bg-[var(--primary-color)] px-2.5 py-1 text-[10px] font-bold tracking-widest text-white">{item.tag}</span>
                    <span className="rounded-full bg-zinc-900/80 backdrop-blur px-2 py-1 text-[10px] font-medium text-zinc-300 border border-zinc-700/50">{item.date}</span>
                  </div>
                </div>
                <div className="bg-zinc-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary-color)]/15 border border-[var(--primary-color)]/20">
                        <Icon size={14} className="text-[var(--primary-color)]" />
                      </span>
                      <h4 className="text-sm font-semibold text-zinc-100 leading-tight">{item.title}</h4>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400 line-clamp-2">{item.description}</p>
                  {item.href && (
                    <a href={item.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary-color)] hover:underline">
                      Learn more <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
        <div aria-label="Card navigation" className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5" role="tablist">
          {items.map((_, i) => (
            <motion.button
              key={i}
              aria-label={`Go to update ${i + 1} of ${items.length}`}
              aria-selected={i === currentIndex}
              role="tab"
              type="button"
              onClick={() => { if (i !== currentIndex && !isScrolling) { setIsScrolling(true); setCurrentIndex(i); scrollY.set(i * SNAP_DISTANCE); setTimeout(() => setIsScrolling(false), 280) } }}
              className={cn("h-1.5 rounded-full transition-all focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]", i === currentIndex ? "w-6 bg-[var(--primary-color)]" : "w-1.5 bg-zinc-600 hover:bg-zinc-500")}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
            />
          ))}
        </div>
        <div aria-live="polite" className="sr-only">{`Update ${currentIndex + 1} of ${items.length} selected.`}</div>
      </div>
    </section>
  )
}

export function WhatsNewDialog({ triggerClassName }: { triggerClassName?: string }) {
  const [open, setOpen] = useState(false)
  const [hasNew, setHasNew] = useState(false)
  const STORAGE_KEY = "detroit-whats-new-seen"

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (v) {
      localStorage.setItem(STORAGE_KEY, whatsNewItems[0].id)
      setHasNew(false)
    }
  }

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY)
    const latestId = whatsNewItems[0]?.id
    if (latestId && lastSeen !== latestId) {
      setHasNew(true)
      const t = setTimeout(() => handleOpenChange(true), 700)
      return () => clearTimeout(t)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className={cn("relative flex h-11 items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 shadow-sm transition-all hover:bg-zinc-700 active:scale-95", triggerClassName)}>
          <Bell className="h-5 w-5 stroke-[1.75]" />
          <span>What's New</span>
          {hasNew && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--primary-color)] ring-2 ring-zinc-900 animate-pulse" />}
          <span className="hidden sm:inline-flex rounded-full bg-[var(--primary-color)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{whatsNewItems.length}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[420px] max-w-[calc(100vw-2rem)] bg-zinc-900 border-zinc-800 p-0 overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 text-left">
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <AgentAvatar seed="whats-new" size={32} />
            What's New
          </DialogTitle>
          <DialogDescription className="text-zinc-500 text-xs">Latest updates & features — scroll, swipe or use arrow keys</DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-6">
          <WhatsNewStack items={whatsNewItems} cardHeight={360} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WhatsNewInline() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><AgentAvatar seed="whats-new" size={24} /> What's New</h3>
      
      </div>
      <p className="text-xs text-zinc-500 mb-4">New features and updates — scroll, swipe or arrow keys to navigate</p>
      <WhatsNewStack items={whatsNewItems} cardHeight={340} className="min-w-[320px]" />
    </div>
  )
}

export default WhatsNewStack
