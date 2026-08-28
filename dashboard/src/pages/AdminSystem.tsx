import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'

type StatusData = {
  status: string
  version: string
  time: string
  health: { sglang: boolean; members_url: string | null; providers: Record<string, any> }
  balance: {
    today: { tokens: number; requests: number }
    week: { tokens: number; requests: number }
    month: { tokens: number; requests: number }
    free_tier: { per_user_weekly_limit: number; per_user_monthly_limit: number; weekly_used: number; monthly_used: number; free_users: number }
  }
  users: { total: number; owners: number; members: number; free: number }
  api_keys: { total: number; active: number }
}

type BalancesData = {
  status: string
  time: string
  providers: Record<string, { provider: string; configured: boolean; status: string; balance: any; error: string | null }>
}

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="text-sm text-zinc-500 mb-1">{title}</div>
      <div className="text-2xl font-bold text-zinc-100 tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  )
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
}

function remainText(k: string, v: any): string {
  if (!v?.balance) return v?.error || (v?.configured ? v.status : '—')
  const b = v.balance
  if (k === 'openrouter' && b.credits_left != null) return `${b.credits_left} credits (used ${b.credits_used} / ${b.credits_total})`
  if (k === 'deepseek' && Array.isArray(b.balance_infos)) {
    if (b.balance_infos.length === 0) return b.available ? 'available (no balance_infos)' : 'no balance'
    return b.balance_infos.map((x: any) => `${x.currency ?? 'CNY'} ${x.total_balance ?? x.topped_up_balance ?? '—'}`).join(', ')
  }
  if (k === 'stripe' && Array.isArray(b.available)) {
    if (b.available.length === 0) return '0'
    return b.available.map((x: any) => `${(x.amount / 100).toFixed(2)} ${String(x.currency).toUpperCase()}`).join(', ')
  }
  if (k === 'sglang') return b.note || b.url || 'ok'
  return v.status === 'unsupported' ? v.error || 'unsupported' : JSON.stringify(b).slice(0, 80)
}

export default function AdminSystem() {
  const { user } = useAuth()
  const [status, setStatus] = useState<StatusData | null>(null)
  const [balances, setBalances] = useState<BalancesData | null>(null)
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [balTab, setBalTab] = useState<'remain' | 'json'>('remain')

  const load = async (isManual = false) => {
    if (status) setRefreshing(true)
    else if (!isManual) setLoading(true)
    try {
      const [s, b, u] = await Promise.all([api.status(), api.getBalances(), api.listUsers()])
      setStatus(s)
      setBalances(b)
      setUsers(u.users || [])
      setErr(null)
    } catch (e: any) {
      if (!status) setErr(e.message || 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(() => load(), 15000)
    return () => clearInterval(id)
  }, [])

  if (!user?.is_owner) return <Navigate to="/" replace />

  if (loading && !status) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (err && !status) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6">
        <p className="text-red-400 text-sm">{err}</p>
        <button onClick={() => load(true)} className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Retry</button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">System Dashboard <span className="rounded-full bg-yellow-900/50 text-yellow-400 text-xs px-2.5 py-0.5">Admin</span></h2>
          <p className="text-sm text-zinc-500 mt-1">v{status?.version} · {status?.time ? new Date(status.time).toLocaleString() : ''}</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {refreshing && <div className="h-0.5 w-full overflow-hidden rounded bg-zinc-800 mb-4"><div className="h-full w-1/3 bg-[var(--primary-color)] animate-[shimmer_1s_ease-in-out_infinite]" /></div>}
      {err && status && <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-2 text-xs text-red-400 mb-4">{err}</div>}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 mb-6">
        <h3 className="font-semibold text-zinc-100 mb-3">Health</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2 text-zinc-300"><Dot ok={!!status?.health.sglang} /> SGLang {status?.health.sglang ? 'online' : 'offline'}</div>
          <div className="text-zinc-400">Image: <span className="text-zinc-200">{status?.health.providers.image_provider || '-'}</span></div>
          <div className="text-zinc-400">DeepSeek: <span className="text-zinc-200">{status?.health.providers.deepseek_configured ? 'configured' : '—'}</span></div>
          <div className="text-zinc-400">Gemini: <span className="text-zinc-200">{status?.health.providers.gemini_configured ? 'configured' : '—'}</span></div>
        </div>
        {status?.health.members_url && <p className="text-xs text-zinc-500 mt-2 break-all">Members: {status.health.members_url}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card title="Total Users" value={status?.users.total ?? 0} sub={`${status?.users.owners} owners · ${status?.users.members} members · ${status?.users.free} free`} />
        <Card title="API Keys" value={status?.api_keys.total ?? 0} sub={`${status?.api_keys.active} active`} />
        <Card title="Today" value={status?.balance.today.tokens ?? 0} sub={`${status?.balance.today.requests} requests`} />
        <Card title="This Month" value={status?.balance.month.tokens ?? 0} sub={`${status?.balance.month.requests} requests`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card title="Week Tokens" value={status?.balance.week.tokens ?? 0} sub={`${status?.balance.week.requests} requests / 7d`} />
        <Card title="Free Tier Weekly" value={status?.balance.free_tier.weekly_used ?? 0} sub={`limit ${status?.balance.free_tier.per_user_weekly_limit?.toLocaleString()} / user · ${status?.balance.free_tier.free_users} users`} />
        <Card title="Free Tier Monthly" value={status?.balance.free_tier.monthly_used ?? 0} sub={`limit ${status?.balance.free_tier.per_user_monthly_limit?.toLocaleString()} / user`} />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 mb-6">
        <Tabs value={balTab} onValueChange={v => setBalTab(v as 'remain' | 'json')}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-zinc-100">Provider Balances</h3>
            <TabsList className="h-8 bg-zinc-800/70 text-zinc-400">
              <TabsTrigger value="remain" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)!">Remain</TabsTrigger>
              <TabsTrigger value="json" className="text-xs px-3 py-1 data-[state=active]:bg-(--primary-color)! data-[state=active]:text-(--primary-foreground)!">JSON</TabsTrigger>
            </TabsList>
          </div>
          {!balances ? <p className="text-sm text-zinc-500">No data</p> : (
            <>
              <TabsContent value="remain">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(balances.providers).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-zinc-200 capitalize">{k}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${v.status === 'ok' ? 'bg-emerald-900/40 text-emerald-400' : v.status === 'not_configured' ? 'bg-zinc-800 text-zinc-500' : v.status === 'unsupported' ? 'bg-zinc-800 text-zinc-400' : 'bg-red-900/40 text-red-400'}`}>{v.status}</span>
                      </div>
                      <div className="text-sm text-zinc-200 break-all">{remainText(k, v)}</div>
                      {v.error && v.status !== 'unsupported' && <p className="text-xs text-red-400 break-all mt-1">{v.error}</p>}
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="json">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(balances.providers).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-zinc-200 capitalize">{k}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${v.status === 'ok' ? 'bg-emerald-900/40 text-emerald-400' : v.status === 'not_configured' ? 'bg-zinc-800 text-zinc-500' : v.status === 'unsupported' ? 'bg-zinc-800 text-zinc-400' : 'bg-red-900/40 text-red-400'}`}>{v.status}</span>
                      </div>
                      {!v.configured && <p className="text-xs text-zinc-500">Not configured</p>}
                      {v.error && <p className="text-xs text-red-400 break-all">{v.error}</p>}
                      {v.balance && <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all mt-1 max-h-32 overflow-auto">{JSON.stringify(v.balance, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>
        <p className="text-xs text-zinc-600 mt-3">Updated: {balances?.time ? new Date(balances.time).toLocaleString() : '-'}</p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h3 className="font-semibold text-zinc-100 mb-3">Users ({users.length})</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.display_name || '-'}</TableCell>
                <TableCell className="text-zinc-400">{u.email}</TableCell>
                <TableCell>{u.is_owner ? <span className="text-yellow-400">Owner</span> : u.is_member ? <span className="text-emerald-400">Member</span> : <span className="text-zinc-500">Free</span>}</TableCell>
                <TableCell>{u.is_verified ? '✓' : '—'}</TableCell>
                <TableCell className="text-xs text-zinc-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
