import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Markdown } from '../components/Markdown'
import UpgradeDialog from '../components/UpgradeDialog'
import { FiSend, FiPlus, FiCopy, FiCheck, FiPaperclip, FiThumbsUp, FiThumbsDown, FiChevronDown, FiZap, FiX, FiArrowRight, FiFileText, FiClock, FiImage, FiSearch } from 'react-icons/fi'
import { useChatHistory } from '../lib/chat-history'
import IOSLoading from '../components/ios-loading'

interface Cta {
  label: string
  href: string
  external?: boolean
  action?: 'upgrade'
}

interface Attachment {
  id: string
  name: string
  kind: 'image' | 'video' | 'text'
  dataUrl?: string
  text?: string
  size: number
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  error?: boolean
  cta?: Cta
  attachments?: Attachment[]
  model?: string
  durationMs?: number
  finish_reason?: string | null
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

interface SseMeta {
  model?: string
  finish_reason?: string | null
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

interface ModelMeta {
  name: string
  desc: string
  badges: string[]
}

const ALLOWED_CHAT_MODELS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'qwen3.7-flash',
  'z-image-turbo',
  'glm-5.3-flash',
  'glm-4.7-flash',
  'glm-4.5-flash',
  'glm-4.6v-flash',
])

const MODEL_META: Record<string, ModelMeta> = {
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro',
    desc: 'Text — most capable for reasoning & coding',
    badges: ['text'],
  },
  'deepseek-v4-flash': {
    name: 'DeepSeek V4 Flash',
    desc: 'Text — fast & lightweight for daily use',
    badges: ['text', 'fast'],
  },
  'deepseek-v4-flash-vision-exp': {
    name: 'DeepSeek V4 Vision',
    desc: 'Text + Image — understands images & text',
    badges: ['text', 'image'],
  },
  'qwen3.7-flash': {
    name: 'Qwen 3.7 Flash',
    desc: 'Text + Image + Video — Alibaba Qwen with thinking mode',
    badges: ['text', 'image', 'video'],
  },
  'z-image-turbo': {
    name: 'Z-Image Turbo',
    desc: 'Image — DashScope text-to-image',
    badges: ['image'],
  },
  'glm-5.3-flash': {
    name: 'GLM-5.3-Flash',
    desc: 'Text + Image + Video — Z.AI fast reasoning (replaces Ox-Alpha)',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-4.7-flash': {
    name: 'GLM-4.7-Flash',
    desc: 'Text + Image + Video — Z.AI',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-4.5-flash': {
    name: 'GLM-4.5-Flash',
    desc: 'Text + Image + Video — Z.AI',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-4.6v-flash': {
    name: 'GLM-4.6V-Flash',
    desc: 'Text + Image + Video — Z.AI vision',
    badges: ['text', 'image', 'video', 'vision'],
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    desc: 'Text + Image — understands images & text',
    badges: ['text', 'image'],
  },
}

const BADGE_STYLES: Record<string, string> = {
  text: 'font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-700/50',
  image: 'font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/15',
  video: 'font-medium bg-orange-500/10 text-orange-400 border border-orange-500/15',
  reasoning: 'font-medium bg-violet-500/10 text-violet-400 border border-violet-500/15',
  vision: 'font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/15',
  fast: 'font-medium bg-sky-500/10 text-sky-400 border border-sky-500/15',
  default: 'font-medium bg-zinc-800/60 text-zinc-500 border border-zinc-700/50',
}

const SUGGESTIONS = [
  'Explain the OpenAI-compatible API',
  'Compare deepseek-v4-pro vs flash',
]

// Rough per-model context window limits (tokens). Used for the usage progress bar.
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'deepseek-v4-pro': 1000000,
  'deepseek-v4-flash': 1000000,
  'deepseek-v4-flash-vision-exp': 1000000,
  'qwen3.7-flash': 1000000,
  'z-image-turbo': 1000000,
  'glm-5.3-flash': 1000000,
  'glm-4.7-flash': 1000000,
  'glm-4.5-flash': 1000000,
  'glm-4.6v-flash': 1000000,
  'gemini-2.5-flash': 1000000,
}

const DEFAULT_CONTEXT_LIMIT = 1000000
const COMPACT_THRESHOLD = 0.85 // auto-compact when usage >= 85%

// Anti-hang protection for streaming responses.
const STREAM_MAX_MS = 300 * 1000 // hard cap: 5 minutes total
const STREAM_IDLE_MS = 45 * 1000 // no data for 45s => assume stuck

// Rough token estimate: ~4 chars per token (English-ish), images ~85 tokens.
function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 4))
}

function estimateMessageTokens(m: Msg): number {
  let t = estimateTextTokens(m.content ?? '')
  if (m.reasoning) t += estimateTextTokens(m.reasoning)
  if (m.attachments) {
    for (const a of m.attachments) {
      if (a.kind === 'image') t += 85
      else if (a.kind === 'video') t += 512
      else if (a.text) t += estimateTextTokens(a.text)
    }
  }
  return t
}

function estimateMessagesTokens(msgs: Msg[]): number {
  let total = 0
  for (const m of msgs) total += estimateMessageTokens(m)
  return total
}

function parseSse(buffer: string, onContent: (text: string) => void, onReasoning: (text: string) => void, onMeta: (meta: SseMeta) => void): string {
  const lines = buffer.split('\n')
  let last = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') continue
    try {
      const json = JSON.parse(data)
      if (json?.error && typeof json.error.message === 'string' && json.error.message) {
        const code = json.error.code ? `[${json.error.code}] ` : ''
        onContent(`${code}${json.error.message}`)
        continue
      }
      if (json?.error && typeof json.error === 'string') {
        onContent(json.error)
        continue
      }
      const delta = json?.choices?.[0]?.delta || {}
      if (typeof delta.content === 'string' && delta.content) onContent(delta.content)
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) onReasoning(delta.reasoning_content)
      const meta: SseMeta = {}
      if (typeof json?.model === 'string' && json.model) meta.model = json.model
      const finish = json?.choices?.[0]?.finish_reason
      if (finish != null) meta.finish_reason = finish
      if (json?.usage && typeof json.usage.prompt_tokens === 'number') {
        meta.usage = {
          prompt_tokens: json.usage.prompt_tokens,
          completion_tokens: typeof json.usage.completion_tokens === 'number' ? json.usage.completion_tokens : 0,
          total_tokens: typeof json.usage.total_tokens === 'number' ? json.usage.total_tokens : 0,
        }
      }
      if (meta.model || meta.usage || meta.finish_reason != null) onMeta(meta)
    } catch {
      last = `${line}\n${last}`
    }
  }
  return last
}

function friendlyError(res: Response, raw: string, membersUrl: string): { content: string; cta?: Cta } {
  if (res.status === 401) {
    return {
      content: 'Your API key is invalid or has expired.',
      cta: { label: 'Create a new API key', href: '/keys' },
    }
  }
  if (res.status === 403) {
    return {
      content: 'Your account does not have access yet.',
      cta: { label: 'Become a member', href: membersUrl || '#', action: 'upgrade' },
    }
  }
  if (res.status === 429) {
    return { content: 'Too many requests. Please wait a minute and try again.' }
  }
  try {
    const json = JSON.parse(raw)
    if (json && typeof json.detail === 'string' && json.detail) return { content: json.detail }
    if (json?.error) {
      const err = json.error
      if (typeof err === 'string' && err) return { content: err }
      if (typeof err.message === 'string' && err.message) {
        const code = err.code ? `[${err.code}] ` : ''
        return { content: `${code}${err.message}` }
      }
      if (typeof err.msg === 'string' && err.msg) return { content: err.msg }
    }
    if (typeof json?.message === 'string' && json.message) return { content: json.message }
  } catch {
    /* fall through to raw */
  }
  if (raw && raw.length < 800) {
    try {
      const j = JSON.parse(raw)
      if (j?.error?.message) return { content: `[${j.error.code ?? 'error'}] ${j.error.message}` }
    } catch {}
    return { content: raw }
  }
  return { content: raw || `Something went wrong (error ${res.status}). Please try again.` }
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }

function isTruncated(m: Msg): boolean {
  if (!m.content) return false
  if (m.finish_reason === 'length') return true
  if ((m.content.match(/```/g) || []).length % 2 === 1) return true
  const text = m.content.trimEnd()
  if (!text) return false
  // Hanging sentence/list connectors left open by a cut-off generation.
  if (/[,;:…–—-]$/.test(text)) return true
  // Dangling inline-markdown run (unclosed emphasis/inline code) at the end.
  const tail = text.split('\n').pop() ?? ''
  const ticks = (tail.match(/`/g) || []).length
  if (ticks % 2 === 1) return true
  return false
}

const TEXT_FILE_EXT = /\.(txt|md|markdown|csv|json|log|py|ts|tsx|js|jsx|html|css|scss|yaml|yml|xml|sh|bash|sql|go|java|rb|php)$/i
const MAX_TEXT_FILE_BYTES = 100 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const IMAGE_MAX_DIM = 1280
const IMAGE_QUALITY = 0.85

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

async function downscaleImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not read this image.'))
    img.src = dataUrl
  })
  const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser.')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}

async function processFile(file: File): Promise<Attachment> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  if (file.type.startsWith('image/')) {
    const dataUrl = await downscaleImage(file)
    return { id, name: file.name, kind: 'image', dataUrl, size: file.size }
  }
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is too large (max 50MB).`)
    const dataUrl = await readFileAsDataUrl(file)
    return { id, name: file.name, kind: 'video', dataUrl, size: file.size }
  }
  if (!TEXT_FILE_EXT.test(file.name)) {
    throw new Error(`Unsupported file type: ${file.name}. Attach an image, video or text file.`)
  }
  if (file.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`${file.name} is too large to attach as text (max 100KB).`)
  }
  const text = await readFileAsText(file)
  return { id, name: file.name, kind: 'text', text, size: file.size }
}

function buildContent(text: string, attachments: Attachment[]): string | ContentPart[] {
  if (!attachments.length) return text
  const parts: ContentPart[] = []
  if (text.trim()) parts.push({ type: 'text', text })
  for (const a of attachments) {
    if (a.kind === 'image' && a.dataUrl) {
      parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
    } else if (a.kind === 'video' && a.dataUrl) {
      parts.push({ type: 'video_url', video_url: { url: a.dataUrl } })
    } else if (a.kind === 'text' && a.text != null) {
      parts.push({ type: 'text', text: `[Attached file: ${a.name}]\n\n${a.text}` })
    }
  }
  return parts
}

function AttachmentPreview({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <div className="relative">
      {attachment.kind === 'image' && attachment.dataUrl ? (
        <img src={attachment.dataUrl} alt={attachment.name} className="h-16 w-16 rounded-lg border border-zinc-700 object-cover" />
      ) : attachment.kind === 'video' && attachment.dataUrl ? (
        <video src={attachment.dataUrl} className="h-16 w-16 rounded-lg border border-zinc-700 object-cover" muted />
      ) : (
        <span className="flex max-w-44 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300">
          <FiFileText size={13} />
          <span className="truncate">{attachment.name}</span>
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 transition-colors hover:bg-red-600 hover:text-white"
        title="Remove attachment"
      >
        <FiX size={12} strokeWidth={3} />
      </button>
    </div>
  )
}

export default function Chat3() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [membersUrl, setMembersUrl] = useState('')
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelOpen, setModelOpen] = useState(false)
  const [freeTier, setFreeTier] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [imageGen, setImageGen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [effort, setEffort] = useState<'low' | 'high' | 'max'>('high')
  const [pending, setPending] = useState<Attachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [isVision, setIsVision] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [oldestPos, setOldestPos] = useState<number | null>(null)
  const { activeId, setActiveId, save: saveConversation, getMessagesPage, appendMessages } = useChatHistory()
  const convSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setSessionToken(localStorage.getItem('session_token'))
  }, [])

  useEffect(() => {
    api.health().then((h) => setMembersUrl((h as { members_url?: string }).members_url || '')).catch(() => {})
  }, [])

  // Open the conversation given by the URL (/chat/:id). /chat without id is always a new chat.
  useEffect(() => {
    if (id) {
      if (id !== activeId) setActiveId(id)
    } else if (activeId) {
      setActiveId(null)
    }
  }, [id, activeId])

  useEffect(() => {
    if (!activeId) setHistoryLoaded(true)
  }, [activeId])

  // Load messages whenever the active conversation changes (via the layout sidebar).
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      setHasMore(true)
      setOldestPos(null)
      setHistoryLoaded(true)
      return
    }
    let cancelled = false
    setHistoryLoaded(false)
    setMessages([])
    setHasMore(true)
    setOldestPos(null)
    getMessagesPage(activeId, { limit: 30 })
      .then(({ messages: msgs, hasMore: hm, oldestPosition }) => {
        if (cancelled) return
        setMessages(msgs)
        setHasMore(hm)
        setOldestPos(oldestPosition)
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const loadMore = async () => {
    if (!activeId || !hasMore || loadingMore || oldestPos == null) return
    setLoadingMore(true)
    const container = scrollRef.current
    const prevHeight = container?.scrollHeight ?? 0
    const prevTop = container?.scrollTop ?? 0
    try {
      const page = await getMessagesPage(activeId, { limit: 30, before: oldestPos })
      if (page.messages.length) {
        setMessages((prev) => [...page.messages, ...prev])
        setOldestPos(page.oldestPosition)
        setHasMore(page.hasMore)
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevHeight + prevTop
        })
      } else {
        setHasMore(false)
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const el = topSentinelRef.current
    const container = scrollRef.current
    if (!el || !container || !hasMore || !historyLoaded) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { root: container, rootMargin: '100px', threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, historyLoaded, oldestPos, activeId])

  useEffect(() => {
    if (!historyLoaded || busy || messages.length === 0) return
    if (activeId) return
    if (convSaveTimer.current) clearTimeout(convSaveTimer.current)
    convSaveTimer.current = setTimeout(async () => {
      const convId = await saveConversation(activeId, messages, model || undefined)
      if (convId && convId !== activeId) {
        navigate(`/chat/${convId}`, { replace: true })
      }
    }, 1200)
    return () => {
      if (convSaveTimer.current) clearTimeout(convSaveTimer.current)
    }
  }, [messages, busy, historyLoaded, model, activeId, saveConversation, navigate])

  useEffect(() => {
    api
      .me()
      .then((me) => setFreeTier(!me.is_member && !me.is_owner && !me.is_paid))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionToken) return
    fetch('/v1/models', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const list = (d?.data || []).map((m: { id: string }) => m.id)
        let filtered = list.filter((id: string) => ALLOWED_CHAT_MODELS.has(id))
        if (!filtered.includes('z-image-turbo') && ALLOWED_CHAT_MODELS.has('z-image-turbo')) {
          filtered = [...filtered, 'z-image-turbo']
        }
        const toShow = filtered.filter((id: string) => ALLOWED_CHAT_MODELS.has(id))
        if (toShow.length) {
          setModels(toShow)
          setModel((cur) =>
            cur && toShow.includes(cur) ? cur : toShow.find((id: string) => id.includes('flash')) || toShow[0]
          )
        }
      })
      .catch(() => {})
  }, [sessionToken])

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

  useEffect(() => {
    resizeTextarea()
  }, [input])

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    setAttaching(true)
    setAttachError(null)
    const added: Attachment[] = []
    for (const f of files) {
      try {
        added.push(await processFile(f))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to attach file.'
        setAttachError(msg)
        window.setTimeout(() => setAttachError(null), 5000)
      }
    }
    if (added.length) setPending((p) => [...p, ...added])
    setAttaching(false)
  }

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await addFiles(files)
  }

  const [dragOver, setDragOver] = useState(false)
  const onDropFiles = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    await addFiles(Array.from(e.dataTransfer.files ?? []))
  }

  const removeAttachment = (id: string) => {
    setPending((p) => p.filter((a) => a.id !== id))
  }

  const resizeTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = Math.round(window.innerHeight * 0.4)
    el.style.maxHeight = `${maxH}px`
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
  }

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    const attachments = [...pending]
    if ((!text && attachments.length === 0) || busy) return
    if (nearLimit && messages.length >= 3) {
      // Auto-compact before the next message to keep the conversation within the context window.
      setMessages((m) => [
        ...m,
        { role: 'user', content: 'Compacting conversation to fit the context window…', model },
      ])
      setBusy(true)
      const ok = await compactChat()
      setBusy(false)
      if (!ok) return
    }
    if (!sessionToken) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: 'You are not logged in. Log in to start chatting.',
          error: true,
          cta: { label: 'Log in', href: '/login' },
        },
      ])
      return
    }
    if (!model) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: 'No model is available right now. Please try again later.',
          error: true,
        },
      ])
      return
    }
    setInput('')
    setPending([])
    const hasImage = attachments.some((a) => a.kind === 'image')
    const hasVideo = attachments.some((a) => a.kind === 'video')
    const hasMedia = hasImage || hasVideo
    const requestModel = freeTier
      ? model.includes('flash') || model === 'glm-5.3-flash'
        ? model
        : 'deepseek-v4-flash'
      : model
    const upstreamModel = hasMedia ? 'gemini-2.5-flash' : requestModel
    setMessages((m) => [...m, { role: 'user', content: text, attachments, model: requestModel }, { role: 'assistant', content: '', reasoning: '', model: upstreamModel }])
    setBusy(true)
    setIsVision(hasMedia)

    const IMAGE_ONLY_MODELS = new Set(['z-image-turbo', 'gpt-image-1', 'dall-e-3', 'gemini-2.0-flash-preview-image-generation'])
    const isImageModel = IMAGE_ONLY_MODELS.has(requestModel)
    const doImageGen = imageGen || isImageModel
    const history = doImageGen
      ? []
      : messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content: m.role === 'user' ? buildContent(m.content, m.attachments ?? []) : m.content,
          }))
    const body: Record<string, unknown> = {
      model: requestModel,
      max_tokens: 1024,
      stream: true,
      messages: doImageGen
        ? [{ role: 'user', content: text }]
        : [...history, { role: 'user', content: buildContent(text, attachments) }],
    }
    if (!hasMedia) {
      if (thinking) {
        body['reasoning'] = { effort }
        body['output_config'] = { effort }
      } else {
        body['reasoning'] = { effort: 'none' }
      }
    }
    if (doImageGen) body['image_gen'] = true
    if (webSearch) body['web_search'] = true

    const controller = new AbortController()
    abortRef.current = controller
    let _logAcc = ''
    let _respModel = upstreamModel
    let _finishReason: string | null | undefined = null
    let _usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined = undefined

    try {
      const res = await fetch('/api/web/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => `HTTP ${res.status}`)
        const err = friendlyError(res, detail, membersUrl)
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = { ...copy[idx], content: err.content, error: true, cta: err.cta }
          } else {
            copy.push({ role: 'assistant', content: err.content, error: true, cta: err.cta })
          }
          return copy
        })
        setBusy(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const startedAt = performance.now()
      let lastChunkAt = performance.now()
      let timedOut = false

      const appendToLast = (key: 'content' | 'reasoning', text: string) => {
        const isUpstreamError = text.includes('⚠️') || /\[13\d{2,3}\]/.test(text) || text.toLowerCase().includes('overloaded') || text.toLowerCase().includes('temporarily overloaded')
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = { ...copy[idx], [key]: (copy[idx][key] ?? '') + text, ...(isUpstreamError && key === 'content' ? { error: true } : {}) }
          }
          return copy
        })
      }

      const patchLastMeta = () => {
        const durationMs = Math.round(performance.now() - startedAt)
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = {
              ...copy[idx],
              durationMs,
              model: _respModel || copy[idx].model,
              finish_reason: _finishReason,
              usage: _usage || copy[idx].usage,
            }
          }
          return copy
        })
      }

      while (true) {
        const now = performance.now()
        if (now - startedAt > STREAM_MAX_MS) {
          timedOut = true
          abortRef.current?.abort()
          break
        }
        if (now - lastChunkAt > STREAM_IDLE_MS) {
          timedOut = true
          abortRef.current?.abort()
          break
        }
        const { done, value } = await reader.read()
        if (done) break
        lastChunkAt = performance.now()
        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        if (import.meta.env.DEV && decoded.length < 2000) {
          console.log('[Chat3 SSE chunk]', decoded)
        }
        buffer = parseSse(
          buffer,
          (c) => {
            if (_logAcc.length < 2000) _logAcc += c
            appendToLast('content', c)
          },
          (r) => {
            if (thinking) appendToLast('reasoning', r)
          },
          (meta) => {
            if (meta.model) _respModel = meta.model
            if (meta.finish_reason != null) _finishReason = meta.finish_reason
            if (meta.usage) _usage = meta.usage
          },
        )
      }
      if (import.meta.env.DEV) console.log('[Chat3 response]', _logAcc)
      patchLastMeta()
      if (_logAcc && (_logAcc.includes('⚠️') || /\[13\d{2,3}\]/.test(_logAcc))) {
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') copy[idx] = { ...copy[idx], error: true }
          return copy
        })
      }
      if (_logAcc) {
        const isErr = _logAcc.includes('⚠️') || /\[13\d{2,3}\]/.test(_logAcc)
        const userMsg: Msg = { role: 'user', content: text, attachments, model: requestModel }
        const asstMsg: Msg = { role: 'assistant', content: _logAcc, model: _respModel, usage: _usage, finish_reason: _finishReason, ...(isErr ? { error: true } : {}) }
        if (activeId) appendMessages(activeId, [userMsg, asstMsg]).catch(() => {})
        else {
          const toSave = [...messages, userMsg, asstMsg]
          saveConversation(null, toSave, model || undefined).then((newId) => {
            if (newId) navigate(`/chat/${newId}`, { replace: true })
          }).catch(() => {})
        }
      }
      if (timedOut) {
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = {
              ...copy[idx],
              content: 'Response took too long and was stopped. Please try again or shorten your question.',
              error: true,
            }
          }
          return copy
        })
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setMessages((m) => {
        const copy = [...m]
        const idx = copy.length - 1
        const patchLast = (content: string, error = false) => {
          if (copy[idx]?.role === 'assistant') {
            copy[idx] = { ...copy[idx], content, error }
          } else {
            copy.push({ role: 'assistant', content, error })
          }
        }
        if (aborted) {
          if (!copy[idx]?.content) patchLast('Stopped.')
        } else {
          patchLast(`Something went wrong. Please try again. (${e instanceof Error ? e.message : String(e)})`, true)
        }
        return copy
      })
    } finally {
      setBusy(false)
      setIsVision(false)
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
    setActiveId(null)
    navigate('/chat')
    setHistoryLoaded(true)
  }

  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT
  const usedTokens = estimateMessagesTokens(messages)
  const usageRatio = contextLimit > 0 ? usedTokens / contextLimit : 0
  const nearLimit = usageRatio >= COMPACT_THRESHOLD

  const compactChat = async (): Promise<boolean> => {
    if (compacting || busy) return false
    if (messages.length < 3) return false
    setCompacting(true)
    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.role === 'user' ? buildContent(m.content, m.attachments ?? []) : m.content,
        }))
      const res = await fetch('/api/web/chat/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ model, messages: history }),
      })
      if (!res.ok) return false
      const data = await res.json()
      const summary = (data?.summary ?? '').trim()
      if (!summary) return false
      // Replace the whole history with a system summary + the last user turn.
      setMessages([
        { role: 'user', content: `[Summary of earlier conversation]\n\n${summary}`, model },
      ])
      return true
    } catch {
      return false
    } finally {
      setCompacting(false)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <>
      <style>{`@keyframes slide { 0%{transform:translateX(0)} 20%{transform:translateX(0)} 80%{transform:translateX(calc(-100% + 100px))} 100%{transform:translateX(calc(-100% + 100px))} }`}</style>
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
        <div className="flex items-center gap-2">
          <div ref={modelRef} className="relative">
            <button
              onClick={() => setModelOpen((o) => !o)}
              className="flex h-9 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <span className="size-2 rounded-full bg-(--primary-color)" />
              <span className="truncate font-medium">{MODEL_META[model]?.name ?? model}</span>
              <FiChevronDown size={14} className={`transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
            </button>
            {modelOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 py-1.5 shadow-xl">
              <div className="max-h-100 overflow-y-auto">
              {models.map((m) => {
                const meta = MODEL_META[m]
                return (
                  <button
                    key={m}
                    onClick={() => {
                      setModel(m)
                      setModelOpen(false)
                    }}
                    className={`group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800 ${
                      m === model ? 'text-zinc-100' : 'text-zinc-400'
                    }`}
                  >
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-(--primary-color)" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="overflow-hidden">
                        <span className="block truncate text-sm font-medium whitespace-nowrap group-hover:animate-[slide_2.5s_linear_infinite]">
                          {meta?.name ?? m}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {meta?.badges.map((b) => (
                          <span
                            key={b}
                            className={`rounded-full px-1.5 py-px text-[9px] uppercase tracking-wide ${
                              BADGE_STYLES[b] ?? BADGE_STYLES.default
                            }`}
                          >
                            {b}
                          </span>
                        ))}
                      </span>
                      <span className="line-clamp-3 text-xs text-zinc-500">{meta?.desc}</span>
                      <span className="truncate font-mono text-[10px] text-zinc-600">{m}</span>
                    </span>
                    {m === model && <FiCheck size={14} className="mt-1 text-(--primary-color)" />}
                  </button>
                )
              })}
              </div>
            </div>
          )}
          </div>
          <button
            onClick={() => setUpgradeOpen(true)}
            className="hidden sm:inline-flex h-7 items-center gap-1.5 rounded-full bg-(--primary-color) px-3 text-xs font-medium text-(--primary-foreground) transition-opacity hover:opacity-90"
          >
            <FiZap size={12} />
            Upgrade
          </button>
          <button
            onClick={() => setUpgradeOpen(true)}
            className="sm:hidden flex h-7 w-7 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground)"
            title="Upgrade"
          >
            <FiZap size={14} />
          </button>
        </div>
        <div className="w-10" />
      </div>

      {/* Messages / empty state */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {!historyLoaded ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
            <IOSLoading size={40} />
            <p className="text-sm text-zinc-500">Loading conversation…</p>
          </div>
        ) : isEmpty ? (
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
            <div ref={topSentinelRef} className="h-px" />
            {loadingMore && <div className="flex justify-center py-2 text-xs text-zinc-500">Loading older messages…</div>}
            {!hasMore && messages.length > 0 && <div className="text-center text-xs text-zinc-600">Beginning of conversation</div>}
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
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-300">
                      Detroit LLM
                      {m.model && m.model !== model && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                          {MODEL_META[m.model]?.name ?? m.model}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mb-1 text-sm font-medium text-zinc-400">You</div>
                  )}
                  {m.role === 'user' && m.attachments && m.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap justify-end gap-2">
                      {m.attachments.map((a) =>
                        a.kind === 'image' && a.dataUrl ? (
                          <img key={a.id} src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-lg border border-zinc-700 object-cover" />
                        ) : a.kind === 'text' ? (
                          <span key={a.id} className="flex max-w-44 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300">
                            <FiFileText size={13} />
                            <span className="truncate">{a.name}</span>
                          </span>
                        ) : null
                      )}
                    </div>
                  )}
                  {m.role === 'assistant' && m.reasoning && thinking && (
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
                  {m.error ? (
                    <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/80 text-white">
                          <FiX size={12} strokeWidth={3} />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-red-300">Something went wrong</div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-red-200/80">
                            {m.content}
                            {m.cta && (
                              <>
                                {' '}
                                {m.cta.action === 'upgrade' ? (
                                  <button
                                    onClick={() => setUpgradeOpen(true)}
                                    className="inline-flex items-center gap-1 font-semibold text-(--primary-color) underline underline-offset-4 transition-colors hover:text-red-100"
                                  >
                                    {m.cta.label}
                                    <FiArrowRight size={13} />
                                  </button>
                                ) : (
                                  <a
                                    href={m.cta.href}
                                    {...(m.cta.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                                    className="inline-flex items-center gap-1 font-semibold text-(--primary-color) underline underline-offset-4 transition-colors hover:text-red-100"
                                  >
                                    {m.cta.label}
                                    <FiArrowRight size={13} />
                                  </a>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 break-words text-[15px] leading-7 text-zinc-200">
                      {m.content ? (
                        m.role === 'assistant' ? (
                          <Markdown>{m.content}</Markdown>
                        ) : (
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        )
                      ) : busy && i === messages.length - 1 ? (
                        <div className="flex items-center gap-3">
                          <IOSLoading size={24} />
                          <span className="text-[13px] text-zinc-400">
                            {isVision ? 'Looking at the image…' : thinking ? 'Reasoning…' : 'Generating…'}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                  {m.role === 'user' && m.content && (
                    <div className="mt-2 flex items-center justify-end">
                      <button
                        onClick={() => copyMsg(m.content)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                        title="Copy"
                      >
                        {copied === m.content ? <FiCheck className="text-green-500" /> : <FiCopy size={15} />}
                      </button>
                    </div>
                  )}
                  {m.role === 'assistant' && m.content && !m.error && (
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
                  {m.role === 'assistant' && isTruncated(m) && !busy && (
                    <button
                      onClick={() => send('continue')}
                      className="mt-2 flex items-center gap-1.5 border hover:border-zinc-100/20
                      border-zinc-800 bg-zinc-800 text-zinc-300 text-[12px] font-medium 
                      px-4 py-1.5 rounded-full transition-colors"
                    >
                      <FiArrowRight size={13} />
                      Continue
                    </button>
                  )}
                  {m.role === 'assistant' && (m.durationMs != null || m.usage || m.model) && !m.error && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-zinc-500">
                      {m.durationMs != null && (
                        <span className="flex items-center gap-1">
                          <FiClock size={10} />
                          {(m.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {m.usage && (
                        <span className="flex items-center gap-1">
                          <span>↑{m.usage.prompt_tokens.toLocaleString()}</span>
                          <span>↓{m.usage.completion_tokens.toLocaleString()}</span>
                          <span>= {m.usage.total_tokens.toLocaleString()} tok</span>
                        </span>
                      )}
                      {m.model && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-1.5 py-px font-medium uppercase tracking-wide">
                          {MODEL_META[m.model]?.name ?? m.model}
                        </span>
                      )}
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-0 pt-2 shrink-0">
        <div
          className={`rounded-[26px]  bg-zinc-900 shadow-[0_4px_20px_rgba(0,0,0,0.4)] transition-colors ${
            dragOver ? 'border-(--primary-color) ring-2 ring-(--primary-color)/30' : 'border-zinc-700 focus-within:border-zinc-500'
          }`}
          onDragEnter={(e) => {
            e.preventDefault()
            if (e.dataTransfer.types.includes('Files')) setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (e.dataTransfer.types.includes('Files')) setDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
          }}
          onDrop={onDropFiles}
        >
          {dragOver && (
            <div className="flex items-center justify-center gap-2 py-3 text-[13px] text-(--primary-color)">
              <FiPaperclip size={15} />
              Drop files to attach
            </div>
          )}
          {!dragOver && pending.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pending.map((a) => (
                <AttachmentPreview key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 px-3 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.txt,.md,.csv,.json,.log,.py,.ts,.tsx,.js,.jsx,.html,.css,.yaml,.yml,.xml,.sh,.sql,.go,.java,.rb,.php"
              className="hidden"
              onChange={onPickFiles}
            />
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40"
              title="Attach a file"
              disabled={busy || attaching}
              onClick={() => fileInputRef.current?.click()}
            >
              <FiPaperclip size={18} />
            </button>
            <textarea
              ref={textareaRef}
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
              className="flex-1 resize-none bg-transparent py-2 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
              style={{ maxHeight: `${Math.round(window.innerHeight * 0.4)}px` }}
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
                disabled={(!input.trim() && pending.length === 0) || attaching}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
                title="Send message"
              >
                <FiSend size={15} className="-mr-0.5" />
              </button>
            )}
          </div>
        </div>
        {attachError && <p className="mt-1 text-center text-xs text-red-400">{attachError}</p>}
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={compactChat}
            className="group relative flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105"
            title={nearLimit ? 'Context nearly full — click to compact' : `Context ${Math.round(usageRatio * 100)}% used — click to compact`}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
              <circle cx="16" cy="16" r="13" fill="none" strokeWidth="4" className="stroke-zinc-800" />
              <circle
                cx="16"
                cy="16"
                r="13"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 13}
                strokeDashoffset={2 * Math.PI * 13 * (1 - Math.min(1, usageRatio))}
                className={`transition-all duration-300 ${
                  nearLimit ? 'stroke-red-500' : usageRatio > 0.6 ? 'stroke-amber-500' : 'stroke-(--primary-color)'
                }`}
              />
            </svg>
            <span className="pointer-events-none absolute text-[9px] font-medium tabular-nums text-zinc-400">
              {Math.round(usageRatio * 100)}%
            </span>
          </button>
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
          <button
            onClick={() => setImageGen((v) => !v)}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
              imageGen
                ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
            title="Toggle image generation"
          >
            <FiImage size={12} />
            Image Gen
          </button>
          <button
            onClick={() => setWebSearch((v) => !v)}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
              webSearch
                ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`}
            title="Toggle web search"
          >
            <FiSearch size={12} />
            Web Search
          </button>
          <div className="flex items-center gap-0.5 rounded-full border border-zinc-800 bg-zinc-900/50 p-0.5">
            {(['low', 'high', 'max'] as const).map((e) => (
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

    <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
