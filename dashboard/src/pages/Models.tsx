import { useEffect, useState } from 'react'
import { FiCheck, FiCopy, FiZap, FiLock, FiUnlock, FiRefreshCw, FiBarChart2 } from 'react-icons/fi'
import { api } from '../lib/api'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

type Tier = 'free' | 'paid'
type ModelInfo = {
  id: string
  tag: string
  desc: string
  ctx: string
  maxOut: string
  tier: Tier
  highlight?: boolean
}

const MODELS: ModelInfo[] = [
  { id: 'deepseek-v4-pro', tag: 'Flagship', desc: 'DeepSeek V4 Pro — most capable for complex reasoning, coding, production workloads', ctx: '1M', maxOut: '—', tier: 'paid', highlight: true },
  { id: 'deepseek-v4-flash', tag: 'Fast', desc: 'DeepSeek V4 Flash — fastest lightweight for daily Q&A and high-volume tasks', ctx: '1M', maxOut: '—', tier: 'free' },
  { id: 'deepseek-v4-flash-vision-exp', tag: 'Vision', desc: 'DeepSeek V4 Vision (experimental) — image understanding on flash backbone', ctx: '1M', maxOut: '—', tier: 'paid' },
  { id: 'claude-haiku-4-5', tag: 'Extra Claude', desc: 'Claude Haiku 4.5 — fastest, 100K Input / 28K Output (Dreamer Extra) · 300K/60K (Nomad Extra)', ctx: '200K', maxOut: '28K', tier: 'paid' },
  { id: 'claude-sonnet-4-6', tag: 'Extra Claude', desc: 'Claude Sonnet 4.6 — balanced reasoning', ctx: '200K', maxOut: '28K', tier: 'paid' },
  { id: 'claude-sonnet-5', tag: 'Extra Claude', desc: 'Claude Sonnet 5 — flagship', ctx: '200K', maxOut: '28K', tier: 'paid' },
  { id: 'claude-fable-5-1', tag: 'Extra Claude', desc: 'Claude Fable 5.1 — creative/long-form', ctx: '200K', maxOut: '28K', tier: 'paid' },
  { id: 'qwen3.7-flash', tag: 'Fast', desc: 'Qwen 3.7 Flash — fast with optional thinking mode', ctx: '128K', maxOut: '—', tier: 'free' },
  { id: 'gemini-2.5-flash', tag: 'Vision', desc: 'Gemini 2.5 Flash — native vision text+image', ctx: '1M', maxOut: '—', tier: 'free' },
  { id: 'z-image-turbo', tag: 'Image', desc: 'z-image-turbo (DashScope) — text-to-image generation', ctx: '1024×1024', maxOut: '—', tier: 'paid' },
  { id: 'glm-image', tag: 'Image', desc: 'glm-image (Z.AI CogView) — text-to-image generation', ctx: '1024×1024', maxOut: '—', tier: 'paid' },
  { id: 'glm-5.3', tag: 'Reasoning', desc: 'GLM-5.3 — 1M context / 128K max (131,072)', ctx: '1M', maxOut: '128K', tier: 'paid' },
  { id: 'glm-5.3-flash', tag: 'Reasoning', desc: 'GLM-5.3-Flash — 1M context / 128K max (131,072)', ctx: '1M', maxOut: '128K', tier: 'paid' },
  { id: 'glm-4.5-air', tag: 'Reasoning', desc: 'GLM-4.5-Air — lightweight reasoning 65,536 / 98,304', ctx: '98K', maxOut: '98K', tier: 'free' },
  { id: 'glm-4.7-flashx', tag: 'Reasoning', desc: 'GLM-4.7-FlashX — high-speed reasoning 65,536 / 131,072', ctx: '1M', maxOut: '131K', tier: 'free' },
]

type RankRow = {
  rank: number
  model: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  unique_users: number
  share_requests: number
  share_tokens: number
  daily: { date: string; tokens: number }[]
}

function Medal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold">1</span>
  if (rank === 2) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-400/20 text-zinc-300 text-xs font-bold">2</span>
  if (rank === 3) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-700/30 text-amber-500 text-xs font-bold">3</span>
  return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-500 text-xs font-medium">{rank}</span>
}

export default function Models() {
  const [filter, setFilter] = useState<'all' | Tier>('all')
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }
  const freeCount = MODELS.filter(m => m.tier === 'free').length
  const paidCount = MODELS.filter(m => m.tier === 'paid').length
  const listAll = MODELS
  const filtered = filter === 'all' ? listAll : listAll.filter(m => m.tier === filter)

  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<RankRow[]>([])
  const [totalReq, setTotalReq] = useState(0)
  const [totalTok, setTotalTok] = useState(0)
  const [rankLoading, setRankLoading] = useState(true)
  const [rankRefreshing, setRankRefreshing] = useState(false)
  const [rankErr, setRankErr] = useState<string | null>(null)

  const loadRanking = async (manual = false) => {
    if (rows.length) setRankRefreshing(true)
    else setRankLoading(true)
    const start = Date.now()
    try {
      const data = await api.getModelsRanking(days, 50)
      setRows(data.models || [])
      setTotalReq(data.total_requests || 0)
      setTotalTok(data.total_tokens || 0)
      setRankErr(null)
    } catch (e: any) {
      if (!rows.length) setRankErr(e.message || 'Failed to load ranking')
    } finally {
      if (manual) {
        const elapsed = Date.now() - start
        if (elapsed < 700) await new Promise(r => setTimeout(r, 700 - elapsed))
      }
      setRankLoading(false)
      setRankRefreshing(false)
    }
  }

  useEffect(() => { loadRanking() }, [days])

  return (
    <div className="p-8 text-zinc-100 font-sans space-y-10 max-w-6xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-serif text-zinc-50">Models</h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-2xl">All available models. <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500 inline-block"/> Free</span> = available on free tier (flash + Air/FlashX). <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500 inline-block"/> Paid</span> = requires membership/paid plan.</p>
        <div className="flex gap-2 mt-4">
          {(['all','free','paid'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium border capitalize transition-colors ${filter===f ? 'bg-zinc-100 text-zinc-900 border-zinc-100' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:bg-zinc-800'}`}>{f} {f==='free' ? `· ${freeCount}` : f==='paid' ? `· ${paidCount}` : `· ${listAll.length}`}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(m => (
          <div key={m.id} className={`rounded-xl border p-5 transition-colors ${m.highlight ? 'border-(--primary-color)/40 bg-(--primary-color)/10' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <code className="font-mono text-sm text-zinc-100 truncate">{m.id}</code>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border uppercase tracking-wide ${m.tier==='free' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : m.id.startsWith('claude-') ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{m.tier==='free' ? <FiUnlock size={10}/> : <FiLock size={10}/>}{m.id.startsWith('claude-') ? 'extra claude' : m.tier}</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">{m.tag}</span>
              <button onClick={() => copy(m.id)} className="ml-auto p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800" title="Copy model id">{copied===m.id ? <FiCheck className="text-green-500" size={12}/> : <FiCopy size={12}/>}</button>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed mb-3">{m.desc}</p>
            <div className="flex gap-3 text-xs border-t border-zinc-800 pt-3">
              <span className="text-zinc-500">Context <span className="text-zinc-300 ml-1">{m.ctx}</span></span>
              <span className="text-zinc-500">Max out <span className="text-zinc-300 ml-1">{m.maxOut}</span></span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-xs leading-5 text-zinc-500">
        <div className="font-medium text-zinc-300 mb-1 flex items-center gap-1.5"><FiZap size={12} className="text-[var(--primary-color)]"/> Free tier rule</div>
        Free = any model with <code className="bg-zinc-800 px-1 py-px rounded">flash</code> in name (except <code className="bg-zinc-800 px-1 py-px rounded">glm-5.3</code>, <code className="bg-zinc-800 px-1 py-px rounded">glm-5.3-flash</code> and <code className="bg-zinc-800 px-1 py-px rounded">deepseek-v4-flash-vision-exp</code> which are paid) plus extra <code className="bg-zinc-800 px-1 py-px rounded">glm-4.5-air</code> / <code className="bg-zinc-800 px-1 py-px rounded">glm-4.7-flashx</code>. Use <code className="bg-zinc-800 px-1 py-px rounded">GET /v1/models</code> with your session token to see your allowed list; API keys see all models.
      </div>

      <div className="border-t border-zinc-800 pt-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2"><FiBarChart2 /> Model Ranking</h2>
            <p className="text-sm text-zinc-500 mt-1">{totalReq.toLocaleString()} requests · {totalTok.toLocaleString()} tokens · {days} days</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="h-9 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200">
              <option value={1}>24 hours</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
            <button onClick={() => loadRanking(true)} disabled={rankRefreshing} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"><FiRefreshCw size={14} className={rankRefreshing ? 'animate-spin' : ''} />{rankRefreshing ? 'Refreshing' : 'Refresh'}</button>
          </div>
        </div>

        {rankRefreshing && <div className="h-0.5 w-full overflow-hidden rounded bg-zinc-800"><div className="h-full w-1/3 bg-[var(--primary-color)] animate-[shimmer_1s_ease-in-out_infinite]" /></div>}

        {rankLoading ? (
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-7 w-7 rounded-full bg-zinc-800" />
                    <Skeleton className="h-4 flex-1 bg-zinc-800" />
                  </div>
                  <Skeleton className="h-7 w-32 bg-zinc-800" />
                  <Skeleton className="h-3 w-40 bg-zinc-800" />
                  <Skeleton className="h-12 w-full bg-zinc-800/60" />
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-8 bg-zinc-800" />
                <Skeleton className="h-4 w-20 bg-zinc-800" />
                <Skeleton className="h-4 w-16 ml-auto bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-20 bg-zinc-800" />
              </div>
              <div className="space-y-2 pt-2">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="h-7 w-7 rounded-full bg-zinc-800" />
                    <Skeleton className="h-4 w-40 bg-zinc-800" />
                    <Skeleton className="h-4 w-20 ml-auto bg-zinc-800" />
                    <Skeleton className="h-4 w-20 bg-zinc-800" />
                    <Skeleton className="h-8 w-24 bg-zinc-800" />
                    <Skeleton className="h-4 w-12 bg-zinc-800" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-[var(--primary-color)]" />
              Loading ranking…
            </div>
          </div>
        ) : rankErr && !rows.length ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6">
            <p className="text-red-400 text-sm">{rankErr}</p>
            <button onClick={() => loadRanking(true)} className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <p className="text-zinc-500 text-sm">No usage in the last {days} days</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {rows.slice(0, 3).map(r => (
                <div key={r.model} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="flex items-center gap-3 mb-2"><Medal rank={r.rank} /><span className="font-mono text-sm text-zinc-100 truncate">{r.model}</span></div>
                  <div className="text-2xl font-bold text-zinc-100">{r.requests.toLocaleString()} <span className="text-xs font-normal text-zinc-500">requests</span></div>
                  <div className="text-xs text-zinc-500 mt-1">{r.total_tokens.toLocaleString()} tokens · {r.share_tokens}%</div>
                  <div className="mt-3 h-12 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={r.daily} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id={`topArea-${r.rank}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary-color)" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="var(--primary-color)" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="tokens" stroke="var(--primary-color)" strokeWidth={1.5} fill={`url(#topArea-${r.rank})`} dot={false} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">#</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="w-32">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.model}>
                      <TableCell><Medal rank={r.rank} /></TableCell>
                      <TableCell className="font-mono text-xs text-zinc-200 max-w-[280px] truncate" title={r.model}>{r.model}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-300">{r.requests.toLocaleString()} <span className="text-xs text-zinc-500">({r.share_requests}%)</span></TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-300">{r.total_tokens.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2" title={`${r.share_tokens}% of tokens`}>
                          <div className="flex-1 h-8 w-24">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={r.daily} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                                <defs>
                                  <linearGradient id={`rankArea-${r.rank}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--primary-color)" stopOpacity={0.5} />
                                    <stop offset="100%" stopColor="var(--primary-color)" stopOpacity={0.05} />
                                  </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey="tokens" stroke="var(--primary-color)" strokeWidth={1.5} fill={`url(#rankArea-${r.rank})`} dot={false} isAnimationActive={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <span className="text-xs tabular-nums text-zinc-400 w-12 text-right">{r.share_tokens}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
