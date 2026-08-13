import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import ApiKeyButtons from '../components/ApiKeyButtons'
import { Skeleton } from '../components/ui/skeleton'

interface UsageRow {
  date: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

const CHART_COLOR = 'var(--primary-color)'
const TOOLTIP_STYLE = { background: '#111111', border: '1px solid #222222', borderRadius: 8, color: '#e4e4e7' }
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const formatDateLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day} ${months[m - 1]}`
}

export default function Usage() {
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [days, setDays] = useState(7)
  const [chart, setChart] = useState<'bar' | 'area'>('bar')
  const [breakdown, setBreakdown] = useState<'table' | 'punchcard'>('punchcard')
  const [punchcard, setPunchcard] = useState<number[][]>([])
  const [punchMax, setPunchMax] = useState(0)
  const [loading, setLoading] = useState(true)
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; startIdx: number; span: number } | null>(null)

  useEffect(() => {
    setZoomRange(null)
  }, [days])

  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoomRange((prev) => {
        const total = usage.length
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
  }, [usage.length])

  const loadUsage = () => {
    Promise.all([api.getUsage(days), api.getUsagePunchcard(days)])
      .then(([u, p]) => {
        setUsage(u.usage || [])
        setPunchcard(p.matrix || [])
        setPunchMax(p.max || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    loadUsage()
    const id = setInterval(loadUsage, 5000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadUsage()
    }
    window.addEventListener('focus', loadUsage)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', loadUsage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [days])

  const totals = usage.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      tokens: acc.tokens + r.total_tokens,
    }),
    { requests: 0, tokens: 0 },
  )

  const cellColor = (count: number) => {
    if (!count) return '#27272a'
    const pct = Math.round(20 + (count / Math.max(1, punchMax)) * 80)
    return `color-mix(in oklab, var(--primary-color) ${pct}%, #18181b)`
  }

  const validRange =
    zoomRange && usage.length > 0 && zoomRange[0] >= 0 && zoomRange[1] < usage.length ? zoomRange : null
  const chartData = validRange ? usage.slice(validRange[0], validRange[1] + 1) : usage

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!validRange || !chartRef.current) return
    dragRef.current = { x: e.clientX, startIdx: validRange[0], span: validRange[1] - validRange[0] + 1 }
  }
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const el = chartRef.current
    if (!d || !el) return
    const pxPerIdx = el.getBoundingClientRect().width / d.span
    const delta = Math.round((e.clientX - d.x) / pxPerIdx)
    const newStart = Math.max(0, Math.min(d.startIdx - delta, Math.max(0, usage.length - d.span)))
    setZoomRange([newStart, newStart + d.span - 1])
  }
  const stopDrag = () => {
    dragRef.current = null
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-zinc-100">Usage</h2>
          <span className="flex items-center gap-1.5 rounded-full bg-green-900/40 px-2.5 py-1 text-xs font-medium text-green-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
            Live
          </span>
        </div>
        <div className="flex items-center">
          <ApiKeyButtons />
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-44 h-11 rounded-2xl bg-zinc-900 border-zinc-700 text-sm text-zinc-200">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-7 w-16" />
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Total Requests</div>
              <div className="text-2xl font-semibold text-zinc-100">{totals.requests}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Total Tokens</div>
              <div className="text-2xl font-semibold text-zinc-100">{totals.tokens.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Avg Tokens / Request</div>
              <div className="text-2xl font-semibold text-zinc-100">
                {totals.requests > 0 ? Math.round(totals.tokens / totals.requests).toLocaleString() : '0'}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl text-white/90! border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-zinc-100">Daily Token Usage</h3>
          <Tabs value={chart} onValueChange={(v) => setChart(v as 'bar' | 'area')}>
            <TabsList className="h-8 bg-zinc-800/70 text-zinc-400">
              <TabsTrigger value="bar" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Bar</TabsTrigger>
              <TabsTrigger value="area" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Area</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {loading ? (
          <Skeleton className="h-80 w-full" />
        ) : usage.length === 0 ? (
          <p className="text-zinc-600 text-sm">No usage data yet.</p>
        ) : (
          <div
            ref={chartRef}
            className="h-80 w-full select-none"
            style={{ cursor: validRange ? 'grab' : 'zoom-in' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
            onDoubleClick={() => setZoomRange(null)}
          >
            <ResponsiveContainer width="100%" height="100%">
              {chart === 'bar' ? (
                <BarChart data={chartData} accessibilityLayer={false}>
                  <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: '#a1a1aa' }}
                    cursor={{ fill: '#3f3f46', opacity: 0.35 }}
                  />
                  <Bar dataKey="total_tokens" name="Tokens" fill={CHART_COLOR} radius={[4, 4, 0, 0]} activeBar={{ fill: '#3f3f46' }} />
                </BarChart>
              ) : (
                <AreaChart data={chartData} accessibilityLayer={false}>
                  <defs>
                    <linearGradient id="usageArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLOR} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={CHART_COLOR} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Area type="monotone" dataKey="total_tokens" name="Tokens" stroke={CHART_COLOR} strokeWidth={2} fill="url(#usageArea)" activeDot={{ fill: '#3f3f46', stroke: '#3f3f46' }} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        {usage.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Scroll to zoom · drag to pan · double-click to reset
          </p>
        )}
      </div>

      <div className="rounded-xl border text-white/90! border-zinc-800 bg-zinc-900/50 p-6 mt-6">
        <Tabs value={breakdown} onValueChange={(v) => setBreakdown(v as 'table' | 'punchcard')}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-zinc-100">Daily Breakdown</h3>
            <TabsList className="h-8 bg-zinc-800/70 text-zinc-400">
              <TabsTrigger value="table" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Table</TabsTrigger>
              <TabsTrigger value="punchcard" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Punchcard</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="table">
            {loading ? (
              <div className="space-y-2 py-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Requests</TableHead>
                    <TableHead>Prompt Tokens</TableHead>
                    <TableHead>Completion Tokens</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((r) => (
                    <TableRow key={r.date}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.requests}</TableCell>
                      <TableCell>{r.prompt_tokens.toLocaleString()}</TableCell>
                      <TableCell>{r.completion_tokens.toLocaleString()}</TableCell>
                      <TableCell>{r.total_tokens.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="punchcard">
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : punchcard.length === 0 ? (
              <p className="text-zinc-600 text-sm">No usage data yet.</p>
            ) : (
              <div>
                <div className="flex flex-col gap-[3px]">
                  <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-[3px]">
                    <div />
                    {HOURS.map((h) => (
                      <div key={h} className="text-center text-[10px] text-zinc-500 leading-none">
                        {h % 4 === 0 ? h : ''}
                      </div>
                    ))}
                  </div>
                  {WEEKDAY_ORDER.map((wd, wi) => (
                    <div key={wd} className="grid grid-cols-[40px_repeat(24,1fr)] gap-[3px] items-center">
                      <div className="text-[10px] text-zinc-500">{WEEKDAY_LABELS[wi]}</div>
                      {HOURS.map((h) => {
                        const count = punchcard[wd]?.[h] ?? 0
                        return (
                          <div
                            key={h}
                            className="aspect-square rounded-[3px]"
                            style={{ backgroundColor: cellColor(count) }}
                            title={`${WEEKDAY_LABELS[wi]} ${String(h).padStart(2, '0')}:00 — ${count} request${count === 1 ? '' : 's'}`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span>Less</span>
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                    <span
                      key={t}
                      className="h-[12px] w-[12px] rounded-[3px]"
                      style={{ backgroundColor: cellColor(Math.round(t * punchMax)) }}
                    />
                  ))}
                  <span>More</span>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
