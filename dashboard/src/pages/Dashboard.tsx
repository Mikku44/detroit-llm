import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { useChartZoom } from '../lib/useChartZoom'
import ApiKeyButtons from '../components/ApiKeyButtons'
import { Skeleton } from '../components/ui/skeleton'

interface UsageRow {
  date: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

interface ModelRow {
  model: string
  requests: number
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

function greeting(h: number) {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [punchcard, setPunchcard] = useState<number[][]>([])
  const [punchMax, setPunchMax] = useState(0)
  const [days, setDays] = useState(7)
  const [activity, setActivity] = useState<'requests' | 'tokens' | 'models'>('tokens')
  const [breakdown, setBreakdown] = useState<'table' | 'punchcard'>('punchcard')
  const [loading, setLoading] = useState(true)

  const { ref, range, onMouseDown, onMouseMove, onMouseUp, reset } = useChartZoom(usage.length)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 60)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    reset()
  }, [days])

  useEffect(() => {
    setLoading(true)
    Promise.all([api.getUsage(days), api.getUsageModels(days), api.getUsagePunchcard(days)])
      .then(([u, m, p]) => {
        setUsage(u.usage || [])
        setModels(m.models || [])
        setPunchcard(p.matrix || [])
        setPunchMax(p.max || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [days])

  const cellColor = (count: number) => {
    if (!count) return '#27272a'
    const pct = Math.round(20 + (count / Math.max(1, punchMax)) * 80)
    return `color-mix(in oklab, var(--primary-color) ${pct}%, #18181b)`
  }

  const totals = usage.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      tokens: acc.tokens + r.total_tokens,
    }),
    { requests: 0, tokens: 0 },
  )

  const chartData = range ? usage.slice(range[0], range[1] + 1) : usage

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2 flex-wrap">
            {greeting(now.getHours())}, {user?.display_name || 'there'}
            {user && (
              user.is_owner ? (
                <span className="rounded-full bg-yellow-900/50 text-yellow-400 text-xs px-2.5 py-0.5 font-medium">Owner</span>
              ) : user.is_member ? (
                <span className="rounded-full bg-emerald-900/50 text-emerald-400 text-xs px-2.5 py-0.5 font-medium">Member</span>
              ) : (
                <span className="rounded-full bg-zinc-800 text-zinc-500 text-xs px-2.5 py-0.5 font-medium">Free</span>
              )
            )}
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ·{' '}
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </p>
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

      {/* Hero summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {loading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Total Requests</div>
              <div className="text-3xl font-bold text-zinc-100">{totals.requests}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Total Tokens</div>
              <div className="text-3xl font-bold text-zinc-100">{totals.tokens.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Avg Tokens / Request</div>
              <div className="text-3xl font-bold text-zinc-100">
                {totals.requests > 0 ? Math.round(totals.tokens / totals.requests).toLocaleString() : '0'}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-sm text-zinc-500 mb-1">Peak Day (Requests)</div>
              <div className="text-3xl font-bold text-zinc-100">
                {usage.length > 0 ? Math.max(...usage.map((r) => r.requests)) : '0'}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Activity graph hero section */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
        <Tabs value={activity} onValueChange={(v) => setActivity(v as 'requests' | 'tokens' | 'models')}>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Activity</h3>
              <p className="text-sm text-zinc-500">Requests and token usage over time</p>
            </div>
            <TabsList className="h-8 bg-zinc-800/70 text-zinc-400">
              <TabsTrigger value="requests" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Requests</TabsTrigger>
              <TabsTrigger value="tokens" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Tokens</TabsTrigger>
              <TabsTrigger value="models" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)! data-[state=active]:shadow-none!">Models</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="requests">
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : usage.length === 0 ? (
              <p className="text-zinc-600 text-sm py-12 text-center">No usage data yet.</p>
            ) : (
              <>
                <div
                  ref={ref}
                  className="h-72 select-none"
                  style={{ cursor: range ? 'grab' : 'zoom-in' }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  onDoubleClick={reset}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} accessibilityLayer={false}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: '#a1a1aa' }}
                        cursor={{ fill: '#3f3f46', opacity: 0.35 }}
                      />
                      <Bar dataKey="requests" name="Requests" fill={CHART_COLOR} radius={[4, 4, 0, 0]} activeBar={{ fill: '#3f3f46' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Scroll to zoom · drag to pan · double-click to reset
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="tokens">
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : usage.length === 0 ? (
              <p className="text-zinc-600 text-sm py-12 text-center">No usage data yet.</p>
            ) : (
              <>
                <div
                  ref={ref}
                  className="h-72 select-none"
                  style={{ cursor: range ? 'grab' : 'zoom-in' }}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  onDoubleClick={reset}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} accessibilityLayer={false}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: '#a1a1aa' }}
                        cursor={{ fill: '#3f3f46', opacity: 0.35 }}
                      />
                      <Bar dataKey="total_tokens" name="Tokens" fill={CHART_COLOR} radius={[4, 4, 0, 0]} activeBar={{ fill: '#3f3f46' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Scroll to zoom · drag to pan · double-click to reset
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="models">
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : models.length === 0 ? (
              <p className="text-zinc-600 text-sm py-12 text-center">No usage data yet.</p>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={models} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} accessibilityLayer={false}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="model" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#a1a1aa' }}
                      cursor={{ fill: '#3f3f46', opacity: 0.35 }}
                    />
                    <Bar dataKey="requests" name="Requests" fill={CHART_COLOR} radius={[4, 4, 0, 0]} activeBar={{ fill: '#3f3f46' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Daily breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
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
