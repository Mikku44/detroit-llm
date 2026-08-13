import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { FiSend, FiPlus, FiCopy, FiCheck, FiPaperclip, FiThumbsUp, FiThumbsDown, FiChevronDown, FiZap, FiX } from 'react-icons/fi'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
}

const SUGGESTIONS = [
  'What is Detroit LLM?',
  'Explain the OpenAI-compatible API',
  'How do I get an API key?',
  'Compare deepseek-v4-pro vs flash',
]

function parseSse(buffer: string, onContent: (text: string) => void, onReasoning: (text: string) => void): string {
  const lines = buffer.split('\n')
  let last = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') continue
    try {
      const json = JSON.parse(data)
      const delta = json?.choices?.[0]?.delta || {}
      if (typeof delta.content === 'string' && delta.content) onContent(delta.content)
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) onReasoning(delta.reasoning_content)
    } catch {
      /* partial json across chunks, keep for next round */
      last = `${line}\n${last}`
    }
  }
  return last
}

export default function Chat3() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [model, setModel] = useState('deepseek-v4-pro')
  const [models, setModels] = useState<string[]>(['deepseek-v4-pro', 'deepseek-v4-flash'])
  const [modelOpen, setModelOpen] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium')
  const modelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    api
      .listKeys()
      .then((d) => {
        const keys = (d.keys || []) as Array<{ key: string; is_active: boolean }>
        const active = keys.find((k) => k.is_active) || keys[0]
        if (active?.key) setApiKey(active.key)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/v1/models')
      .then((r) => r.json())
      .then((d) => {
        const list = (d?.data || []).map((m: { id: string }) => m.id)
        if (list.length) setModels(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return
    if (!apiKey) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: '[Error] No API key found. Create one on the API Keys page first.' },
      ])
      return
    }
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
    const body: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      stream: true,
      messages: [...history, { role: 'user', content: text }],
    }
    if (thinking) {
      body['thinking'] = { type: 'enabled' }
      body['reasoning_effort'] = effort
    } else {
      body['thinking'] = { type: 'disabled' }
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => `HTTP ${res.status}`)
        setMessages((m) => [...m, { role: 'assistant', content: `[Error] ${detail}` }])
        setBusy(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let logAcc = ''

      setMessages((m) => [...m, { role: 'assistant', content: '', reasoning: '' }])

      const appendToLast = (key: 'content' | 'reasoning', text: string) => {
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = { ...copy[idx], [key]: (copy[idx][key] ?? '') + text }
          }
          return copy
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        console.log('[Chat3 SSE chunk]', decoded)
        buffer = parseSse(
          buffer,
          (c) => {
            logAcc += c
            appendToLast('content', c)
          },
          (r) => appendToLast('reasoning', r),
        )
      }
      console.log('[Chat3 response]', logAcc)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setMessages((m) => [...m, { role: 'assistant', content: `[Error] ${e instanceof Error ? e.message : String(e)}` }])
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const copyMsg = (content: string) => {
    navigator.clipboard.writeText(content)
    setCopied(content)
    setTimeout(() => setCopied(null), 1500)
  }

  const clearChat = () => {
    stop()
    setMessages([])
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-2 px-1 shrink-0">
        <button
          onClick={clearChat}
          className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          title="New chat"
        >
          <FiPlus size={20} />
        </button>
        <div ref={modelRef} className="relative">
          <button
            onClick={() => setModelOpen((o) => !o)}
            className="flex h-9 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <span className="size-2 rounded-full bg-(--primary-color)" />
            {model}
            <FiChevronDown size={14} className={`transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
          </button>
          {modelOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 py-1.5 shadow-xl">
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModel(m)
                    setModelOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-zinc-800 ${
                    m === model ? 'text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full bg-(--primary-color)" />
                  <span className="truncate font-mono text-xs">{m}</span>
                  {m === model && <FiCheck size={14} className="ml-auto text-(--primary-color)" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-10" />
      </div>

      {/* Messages / empty state */}
      <div className="flex-1 overflow-y-auto min-h-0">        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-8 px-4 pb-10">
            <h1 className="text-center text-2xl sm:text-3xl font-medium text-zinc-100">
              What can I help with?
            </h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6 space-y-8">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className="shrink-0">
                  {m.role === 'assistant' ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">
                      D
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 text-sm font-semibold">
                      Y
                    </div>
                  )}
                </div>
                <div className={`min-w-0 flex-1 ${m.role === 'user' ? 'text-right' : ''}`}>
                  {m.role === 'assistant' ? (
                    <div className="mb-1 text-sm font-medium text-zinc-300">Detroit LLM</div>
                  ) : (
                    <div className="mb-1 text-sm font-medium text-zinc-400">You</div>
                  )}
                  {m.role === 'assistant' && m.reasoning && (
                    <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        <FiZap size={12} className="text-(--primary-color)" />
                        Thinking
                      </div>
                      <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-zinc-500">
                        {m.reasoning}
                      </div>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-200">
                    {m.content || (busy && i === messages.length - 1 ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-500">
                        <span className="inline-block size-2 rounded-full bg-zinc-500 animate-pulse" />
                        {thinking ? 'Reasoning…' : 'Thinking…'}
                      </span>
                    ) : null)}
                  </div>
                  {m.role === 'assistant' && m.content && (
                    <div className="mt-2 flex items-center gap-0.5">
                      <button
                        onClick={() => copyMsg(m.content)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                        title="Copy"
                      >
                        {copied === m.content ? <FiCheck className="text-green-500" /> : <FiCopy size={15} />}
                      </button>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                        title="Good response"
                      >
                        <FiThumbsUp size={14} />
                      </button>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                        title="Bad response"
                      >
                        <FiThumbsDown size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-2 shrink-0">
        <div className="flex items-end gap-2 rounded-[26px] border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.4)] focus-within:border-zinc-500 transition-colors">
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            title="Attach"
            onClick={() => {}}
          >
            <FiPaperclip size={18} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Ask anything"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          {busy ? (
            <button
              onClick={stop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-black hover:bg-white transition-colors"
              title="Stop generating"
            >
              <div className="size-3 rounded-[3px] bg-current" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
              title="Send message"
            >
              <FiSend size={15} className="-mr-0.5" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={() => setThinking((t) => !t)}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
              thinking
                ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
            title="Toggle thinking mode"
          >
            <FiZap size={12} />
            {thinking ? 'Thinking On' : 'Thinking Off'}
          </button>
          <div className="flex items-center gap-0.5 rounded-full border border-zinc-800 bg-zinc-900/50 p-0.5">
            {(['low', 'medium', 'high'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEffort(e)}
                disabled={!thinking}
                className={`h-7 rounded-full px-3 text-xs capitalize transition-colors disabled:opacity-40 ${
                  effort === e && thinking
                    ? 'bg-(--primary-color) text-(--primary-foreground)'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title={`Reasoning effort: ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-600">
          Model can make mistakes. Check important info.
        </p>
      </div>
    </div>
  )
}
