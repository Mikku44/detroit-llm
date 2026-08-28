import { useState, useRef } from 'react'
import { FiRefreshCw, FiZap, FiServer, FiActivity, FiClock, FiTrash2, FiDownload } from 'react-icons/fi'

type LogEntry = {
  id: string
  time: string
  method: string
  path: string
  status: number
  gateway: string
  handler: string
  latency: string
  via: string
}

const ENDPOINTS = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/v1/models' },
  { method: 'GET', path: '/admin/status' },
  { method: 'GET', path: '/api/conversations' },
]

function badgeColor(gateway: string) {
  if (gateway.includes('go-edge')) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  if (gateway.includes('fastapi')) return 'bg-sky-500/15 text-sky-400 border-sky-500/20'
  if (gateway.includes('fallback')) return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
  return 'bg-zinc-800 text-zinc-400 border-zinc-700'
}

export default function Console() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const intervalRef = useRef<number | null>(null)

  const probe = async (method: string, path: string) => {
    const t0 = performance.now()
    let status = 0
    let headers: Record<string, string> = {}
    try {
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem('session_token') || ''}` },
      })
      status = res.status
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
      await res.clone().text().catch(() => {})
    } catch {
      status = 0
    }
    const latency = `${(performance.now() - t0).toFixed(0)}ms`
    const gateway = headers['x-gateway'] || 'unknown'
    const handler = headers['x-handler'] || headers['x-served-by'] || '-'
    const rt = headers['x-response-time'] || latency
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleTimeString(),
      method,
      path,
      status,
      gateway,
      handler,
      latency: rt,
      via: gateway,
    } as LogEntry
  }

  const runAll = async () => {
    setBusy(true)
    const results: LogEntry[] = []
    for (const ep of ENDPOINTS) {
      const entry = await probe(ep.method, ep.path)
      results.push(entry)
      setLogs((prev) => [entry, ...prev].slice(0, 100))
    }
    setBusy(false)
    return results
  }

  const runSingle = async (path: string, method = 'GET') => {
    const entry = await probe(method, path)
    setLogs((prev) => [entry, ...prev].slice(0, 100))
  }

  const toggleAuto = () => {
    if (auto) {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      intervalRef.current = null
      setAuto(false)
    } else {
      setAuto(true)
      runAll()
      intervalRef.current = window.setInterval(() => {
        probe('GET', '/health').then((e) => setLogs((prev) => [e, ...prev].slice(0, 100)))
      }, 3000)
    }
  }

  const clear = () => setLogs([])
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `console-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const goCount = logs.filter((l) => l.gateway.includes('go-edge')).length
  const pyCount = logs.filter((l) => l.gateway.includes('fastapi')).length

  return (
    <div className="flex flex-col gap-4 w-full max-w-none">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <FiServer className="text-[var(--primary-color)]" /> Gateway Console
          </h1>
          <p className="text-sm text-zinc-500">
            ดูว่า request ไหน return จาก <span className="text-emerald-400 font-medium">go-edge</span> หรือ <span className="text-sky-400 font-medium">fastapi</span> ผ่าน header <code className="bg-zinc-800 px-1.5 py-px rounded text-xs">X-Gateway</code> / <code className="bg-zinc-800 px-1.5 py-px rounded text-xs">X-Handler</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAuto}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${auto ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
          >
            <FiActivity size={12} /> {auto ? 'Auto ON' : 'Auto OFF'}
          </button>
          <button onClick={exportLogs} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
            <FiDownload size={12} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-xs text-zinc-500">Go Edge</div>
          <div className="text-2xl font-semibold text-emerald-400">{goCount}</div>
          <div className="text-xs text-zinc-600">X-Gateway: go-edge</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-xs text-zinc-500">FastAPI</div>
          <div className="text-2xl font-semibold text-sky-400">{pyCount}</div>
          <div className="text-xs text-zinc-600">X-Gateway: fastapi</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-xs text-zinc-500">Total</div>
          <div className="text-2xl font-semibold text-zinc-100">{logs.length}</div>
          <div className="text-xs text-zinc-600">last 100</div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runAll}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--primary-color)] px-4 py-1.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50 hover:opacity-90"
          >
            <FiZap size={14} /> {busy ? 'Probing...' : 'Probe All'}
          </button>
          <button
            onClick={() => runAll()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            <FiRefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={clear} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700">
            <FiTrash2 size={12} /> Clear
          </button>
          <span className="text-xs text-zinc-600 ml-auto flex items-center gap-1">
            <FiClock size={12} /> live console — แสดง X-Gateway / X-Handler / latency
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ENDPOINTS.map((ep) => (
            <button
              key={ep.path}
              onClick={() => runSingle(ep.path, ep.method)}
              className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {ep.method} {ep.path}
            </button>
          ))}
          <button onClick={() => runSingle('/v1/chat/completions', 'POST')} className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800">
            POST /v1/chat/completions
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/30">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <span className="text-xs font-medium text-zinc-400">Live Log</span>
          <span className="text-xs text-zinc-600">browser fetch — ดู Network → Response Headers ประกอบได้</span>
        </div>
        <div className="max-h-[480px] overflow-auto">
          {logs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-600">ยังไม่มี log — กด Probe All เพื่อดูว่าแต่ละ path กลับจาก Go หรือ FastAPI</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Time</th>
                  <th className="text-left px-2 py-1.5 font-medium">Method</th>
                  <th className="text-left px-2 py-1.5 font-medium">Path</th>
                  <th className="text-left px-2 py-1.5 font-medium">Status</th>
                  <th className="text-left px-2 py-1.5 font-medium">X-Gateway</th>
                  <th className="text-left px-2 py-1.5 font-medium">X-Handler</th>
                  <th className="text-right px-3 py-1.5 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-3 py-1.5 text-zinc-500">{l.time}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-px text-[10px] font-medium border ${l.method === 'GET' ? 'bg-zinc-800 text-zinc-300 border-zinc-700' : 'bg-violet-500/15 text-violet-400 border-violet-500/20'}`}>{l.method}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-zinc-300 truncate max-w-[260px]">{l.path}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-px text-[10px] font-medium ${l.status >= 200 && l.status < 300 ? 'bg-emerald-500/15 text-emerald-400' : l.status >= 400 ? 'bg-red-500/15 text-red-400' : 'bg-zinc-800 text-zinc-400'}`}>{l.status || '-'}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium ${badgeColor(l.gateway)}`}>
                        <span className={`size-1.5 rounded-full mr-1 ${l.gateway.includes('go-edge') ? 'bg-emerald-400' : l.gateway.includes('fastapi') ? 'bg-sky-400' : 'bg-zinc-500'}`} />
                        {l.gateway}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-zinc-400 truncate max-w-[180px]">{l.handler}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{l.latency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-xs leading-5 text-zinc-500">
        <div className="font-medium text-zinc-300 mb-1">วิธีดูจาก DevTools</div>
        Open DevTools → Network → คลิก request → Headers → <code className="bg-zinc-800 px-1 py-px rounded">X-Gateway</code> จะเป็น <code className="bg-emerald-900/30 text-emerald-400 px-1 py-px rounded">go-edge</code> หรือ <code className="bg-sky-900/30 text-sky-400 px-1 py-px rounded">fastapi</code> และ <code className="bg-zinc-800 px-1 py-px rounded">X-Handler</code> บอก handler ย่อย เช่น <code className="bg-zinc-800 px-1 py-px rounded">chat-go / conversations-go / proxy-fallback / rate-limit</code> — Console นี้อ่าน header ให้เลย
      </div>
    </div>
  )
}
