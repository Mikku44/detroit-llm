import { useEffect, useRef, useState } from 'react'

class Pixel {
  width: number
  height: number
  ctx: CanvasRenderingContext2D
  x: number
  y: number
  color: string
  speed: number
  size: number
  sizeStep: number
  minSize: number
  maxSizeInteger: number
  maxSize: number
  delay: number
  counter: number
  counterStep: number
  isIdle: boolean
  isReverse: boolean
  isShimmer: boolean

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    speed: number,
    delay: number
  ) {
    this.width = canvas.width
    this.height = canvas.height
    this.ctx = context
    this.x = x
    this.y = y
    this.color = color
    this.speed = this.getRandomValue(0.1, 0.9) * speed
    this.size = 0
    this.sizeStep = Math.random() * 0.4
    this.minSize = 0.5
    this.maxSizeInteger = 2
    this.maxSize = this.getRandomValue(this.minSize, this.maxSizeInteger)
    this.delay = delay
    this.counter = 0
    this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01
    this.isIdle = false
    this.isReverse = false
    this.isShimmer = false
  }

  getRandomValue(min: number, max: number) {
    return Math.random() * (max - min) + min
  }

  draw() {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5
    this.ctx.fillStyle = this.color
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size)
  }

  appear() {
    this.isIdle = false
    if (this.counter <= this.delay) {
      this.counter += this.counterStep
      return
    }
    if (this.size >= this.maxSize) {
      this.isShimmer = true
    }
    if (this.isShimmer) {
      this.shimmer()
    } else {
      this.size += this.sizeStep
    }
    this.draw()
  }

  shimmer() {
    if (this.size >= this.maxSize) {
      this.isReverse = true
    } else if (this.size <= this.minSize) {
      this.isReverse = false
    }
    if (this.isReverse) {
      this.size -= this.speed
    } else {
      this.size += this.speed
    }
  }
}

function getEffectiveSpeed(value: number, reducedMotion: boolean) {
  const min = 0
  const max = 100
  const throttle = 0.001
  if (value <= min || reducedMotion) {
    return min
  } else if (value >= max) {
    return max * throttle
  } else {
    return value * throttle
  }
}

const WORDS = ['drawing', 'retouching', 'dreaming', 'rendering', 'painting', 'imagining', 'composing', 'developing', 'sketching', 'conjuring']

export default function ImageGenLoading({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixelsRef = useRef<Pixel[]>([])
  const animationRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const timePreviousRef = useRef(performance.now())
  const [word, setWord] = useState(() => WORDS[Math.floor(Math.random() * WORDS.length)])

  useEffect(() => {
    const iv = window.setInterval(() => {
      setWord((prev) => {
        let next = prev
        while (next === prev) {
          next = WORDS[Math.floor(Math.random() * WORDS.length)]
        }
        return next
      })
    }, 1800)
    return () => window.clearInterval(iv)
  }, [])

  useEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const initPixels = () => {
      if (!containerRef.current || !canvasRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      if (!width || !height) return
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return
      canvasRef.current.width = width
      canvasRef.current.height = height
      canvasRef.current.style.width = `${width}px`
      canvasRef.current.style.height = `${height}px`
      const colorsArray = '#27272a,#3f3f46,#52525b,#71717a,#a1a1aa'.split(',')
      const gap = 5
      const speed = getEffectiveSpeed(35, reducedMotion)
      const pxs: Pixel[] = []
      for (let x = 0; x < width; x += gap) {
        for (let y = 0; y < height; y += gap) {
          const color = colorsArray[Math.floor(Math.random() * colorsArray.length)]
          const dx = x - width / 2
          const dy = y - height / 2
          const distance = Math.sqrt(dx * dx + dy * dy)
          pxs.push(new Pixel(canvasRef.current, ctx, x, y, color, speed, reducedMotion ? 0 : distance))
        }
      }
      pixelsRef.current = pxs
    }

    const doAnimate = () => {
      animationRef.current = requestAnimationFrame(doAnimate)
      const timeNow = performance.now()
      const timePassed = timeNow - timePreviousRef.current
      const timeInterval = 1000 / 60
      if (timePassed < timeInterval) return
      timePreviousRef.current = timeNow - (timePassed % timeInterval)
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const pixel of pixelsRef.current) pixel.appear()
    }

    initPixels()
    timePreviousRef.current = performance.now()
    animationRef.current = requestAnimationFrame(doAnimate)
    const observer = new ResizeObserver(() => {
      initPixels()
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    }
  }, [])

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <p key={word} className="text-[13px] text-zinc-400 animate-in fade-in duration-300">
        <span className="capitalize">{word}</span>
        <span className="animate-pulse">…</span>
      </p>
      <div
        ref={containerRef}
        className="relative aspect-square w-full max-w-[320px] select-none overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 isolate"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  )
}
