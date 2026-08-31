import { useState } from 'react'
import { FiCheck, FiCopy, FiZap, FiLock, FiUnlock } from 'react-icons/fi'


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
  { id: 'qwen3.7-flash', tag: 'Fast', desc: 'Qwen 3.7 Flash — fast with optional thinking mode', ctx: '128K', maxOut: '—', tier: 'free' },
  { id: 'gemini-2.5-flash', tag: 'Vision', desc: 'Gemini 2.5 Flash — native vision text+image', ctx: '1M', maxOut: '—', tier: 'free' },
  { id: 'z-image-turbo', tag: 'Image', desc: 'z-image-turbo (DashScope) — text-to-image generation', ctx: '1024×1024', maxOut: '—', tier: 'paid' },
  { id: 'glm-5.3-flash', tag: 'Reasoning', desc: 'GLM-5.3-Flash — 1M context / 128K max (131,072)', ctx: '1M', maxOut: '128K', tier: 'paid' },
  { id: 'glm-4.5-air', tag: 'Reasoning', desc: 'GLM-4.5-Air — lightweight reasoning 65,536 / 98,304', ctx: '98K', maxOut: '98K', tier: 'free' },
  { id: 'glm-4.7-flashx', tag: 'Reasoning', desc: 'GLM-4.7-FlashX — high-speed reasoning 65,536 / 131,072', ctx: '1M', maxOut: '131K', tier: 'free' },
]

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
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border uppercase tracking-wide ${m.tier==='free' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{m.tier==='free' ? <FiUnlock size={10}/> : <FiLock size={10}/>}{m.tier}</span>
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
        Free = any model with <code className="bg-zinc-800 px-1 py-px rounded">flash</code> in name (except <code className="bg-zinc-800 px-1 py-px rounded">glm-5.3-flash</code> and <code className="bg-zinc-800 px-1 py-px rounded">deepseek-v4-flash-vision-exp</code> which are paid) plus extra <code className="bg-zinc-800 px-1 py-px rounded">glm-4.5-air</code> / <code className="bg-zinc-800 px-1 py-px rounded">glm-4.7-flashx</code>. Use <code className="bg-zinc-800 px-1 py-px rounded">GET /v1/models</code> with your session token to see your allowed list; API keys see all models.
      </div>
    </div>
  )
}
