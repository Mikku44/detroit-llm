import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Markdown } from '../components/Markdown'
import UpgradeDialog from '../components/UpgradeDialog'
import { FiSend, FiPlus, FiCopy, FiCheck, FiPaperclip, FiThumbsUp, FiThumbsDown, FiChevronDown, FiZap, FiX, FiArrowRight, FiFileText, FiClock, FiImage, FiSearch } from 'react-icons/fi'
import { useChatHistory } from '../lib/chat-history'
import IOSLoading from '../components/ios-loading'
import ImageGenLoading from '../components/ImageGenLoading'
import AILoader from '../components/smoothui/ai-loader'
import { Skeleton } from '../components/ui/skeleton'
import { motion, AnimatePresence } from 'motion/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'

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
  id?: string
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
  reaction?: 'like' | 'dislike' | null
  like_count?: number
  dislike_count?: number
  position?: number
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
  'qwen3.8-flash',
  'z-image-turbo',
  'glm-image',
  // 'grok-imagine-image', // hidden for now
  'glm-5.3',
  'glm-5.3-flash',
  'glm-4.5-air',
  'glm-4.7-flashx',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-fable-5-1',
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
  'qwen3.8-flash': {
    name: 'Qwen 3.8 Flash',
    desc: 'Text + Image + Video — Alibaba Qwen with thinking mode',
    badges: ['text', 'image', 'video'],
  },
  'z-image-turbo': {
    name: 'Z-Image Turbo',
    desc: 'Image — DashScope text-to-image',
    badges: ['image'],
  },
  'glm-image': {
    name: 'GLM Image',
    desc: 'Image — Z.AI text-to-image (CogView)',
    badges: ['image'],
  },
  // 'grok-imagine-image': hidden for now
  'glm-5.3': {
    name: 'GLM-5.3',
    desc: 'Text + Image + Video — Z.AI reasoning flagship',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-5.3-flash': {
    name: 'GLM-5.3-Flash',
    desc: 'Text + Image + Video — Z.AI fast reasoning (replaces Ox-Alpha)',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-4.5-air': {
    name: 'GLM-4.5-Air',
    desc: 'Text + Image + Video — Z.AI lightweight reasoning',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'glm-4.7-flashx': {
    name: 'GLM-4.7-FlashX',
    desc: 'Text + Image + Video — Z.AI high-speed reasoning',
    badges: ['text', 'image', 'video', 'reasoning'],
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    desc: 'Text + Image — understands images & text',
    badges: ['text', 'image'],
  },
  'claude-haiku-4-5': {
    name: 'Claude Haiku 4.5',
    desc: 'Extra Claude — fastest, 200K context',
    badges: ['text', 'extra-claude'],
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    desc: 'Extra Claude — balanced reasoning',
    badges: ['text', 'extra-claude'],
  },
  'claude-sonnet-5': {
    name: 'Claude Sonnet 5',
    desc: 'Extra Claude — flagship reasoning',
    badges: ['text', 'extra-claude'],
  },
  'claude-fable-5-1': {
    name: 'Claude Fable 5.1',
    desc: 'Extra Claude — creative / long-form',
    badges: ['text', 'extra-claude'],
  },
}

const BADGE_STYLES: Record<string, string> = {
  text: 'font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-700/50',
  image: 'font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/15',
  video: 'font-medium bg-orange-500/10 text-orange-400 border border-orange-500/15',
  reasoning: 'font-medium bg-violet-500/10 text-violet-400 border border-violet-500/15',
  vision: 'font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/15',
  fast: 'font-medium bg-sky-500/10 text-sky-400 border border-sky-500/15',
  'extra-claude': 'font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20',
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
  'qwen3.8-flash': 1000000,
  'z-image-turbo': 1000000,
  'glm-image': 1000000,
  // 'grok-imagine-image': hidden for now
  'glm-5.3': 1000000,
  'glm-5.3-flash': 1000000,
  'glm-4.5-air': 1000000,
  'glm-4.7-flashx': 1000000,
  'gemini-2.5-flash': 1000000,
  'claude-haiku-4-5': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-5': 200000,
  'claude-fable-5-1': 200000,
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

// Consume complete SSE events, retaining only the unfinished event.
function parseSse(buffer: string, onContent: (text: string) => void, onReasoning: (text: string) => void, onMeta: (meta: SseMeta) => void, onDone: () => void = () => {}): string {
  let match: RegExpExecArray | null
  while ((match = /\r?\n\r?\n/.exec(buffer))) {
    const event = buffer.slice(0, match.index)
    buffer = buffer.slice(match.index + match[0].length)
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data) continue
    if (data.trim() === '[DONE]') { onDone(); return '' }
    let json: any
    try { json = JSON.parse(data) } catch { throw new Error('Invalid streaming response.') }
    if (json?.error) {
      const err = json.error
      throw new Error(typeof err === 'string' ? err : `${err.code ? `[${err.code}] ` : ''}${err.message || 'Stream failed.'}`)
    }
    const choice = json?.choices?.[0]
    const delta = choice?.delta || {}
    if (typeof delta.content === 'string') onContent(delta.content)
    if (typeof delta.reasoning_content === 'string') onReasoning(delta.reasoning_content)
    const meta: SseMeta = {}
    if (typeof json?.model === 'string') meta.model = json.model
    if (choice?.finish_reason != null) meta.finish_reason = choice.finish_reason
    if (typeof json?.usage?.prompt_tokens === 'number') {
      const prompt_tokens = json.usage.prompt_tokens
      const completion_tokens = json.usage.completion_tokens ?? 0
      meta.usage = { prompt_tokens, completion_tokens, total_tokens: json.usage.total_tokens ?? prompt_tokens + completion_tokens }
    }
    onMeta(meta)
  }
  return buffer
}

// Timers also run while fetch()/reader.read() is awaiting data.
function streamDeadline(controller: AbortController) {
  let expired = false
  let idle: ReturnType<typeof setTimeout>
  const expire = () => { expired = true; controller.abort() }
  const hard = setTimeout(expire, STREAM_MAX_MS)
  const touch = () => { clearTimeout(idle); idle = setTimeout(expire, STREAM_IDLE_MS) }
  touch()
  return { touch, expired: () => expired, dispose: () => { clearTimeout(hard); clearTimeout(idle) } }
}

async function consumeStream(response: Response, controller: AbortController, touch: () => void,
  onContent: (text: string) => void, onReasoning: (text: string) => void, onMeta: (meta: SseMeta) => void) {
  if (!response.body) throw new Error('Response has no stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  try {
    while (!finished) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      touch()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      // Flush a final event even when the server omits its trailing blank line.
      if (done && buffer.trim()) buffer += '\n\n'
      buffer = parseSse(buffer, onContent, onReasoning, onMeta, () => { finished = true })
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
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
  const [model, setModel] = useState('qwen3.8-flash')
  const [models, setModels] = useState<string[]>([])
  const [modelOpen, setModelOpen] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(true)
  const [freeTier, setFreeTier] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [imageGen, setImageGen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [effort, setEffort] = useState<'low' | 'high' | 'max'>('high')
  const [pending, setPending] = useState<Attachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [isVision, setIsVision] = useState(false)
  const [busyIsImage, setBusyIsImage] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [oldestPos, setOldestPos] = useState<number | null>(null)
  const [dailyUsed, setDailyUsed] = useState<number | null>(null)
  const [dailyLimit, setDailyLimit] = useState<number | null>(null)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [askFirst, setAskFirst] = useState(true)
  const [confirm, setConfirm] = useState<{ kind: 'image' | 'search'; title: string; detail: string } | null>(null)
  const [pendingText, setPendingText] = useState<string | undefined>(undefined)
  const { activeId, setActiveId, save: saveConversation, getMessagesPage, appendMessages } = useChatHistory()
  const operationRef = useRef(0)
  const sendingRef = useRef(false)
  const pagingRef = useRef(false)
  const routeRef = useRef(id)
  routeRef.current = id
  const contextRef = useRef<Msg[] | null>(null)
  const stickToBottomRef = useRef(true)
  const modelRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    operationRef.current += 1
    abortRef.current?.abort()
    sendingRef.current = false
    pagingRef.current = false
    contextRef.current = null
    setBusy(false)
    setCompacting(false)
    setLoadingMore(false)
    setBusyIsImage(false)
    setPending([])
    setInput('')
    stickToBottomRef.current = true
    return () => { operationRef.current += 1; abortRef.current?.abort() }
  }, [id])

  // Open the conversation given by the URL (/chat/:id). /chat without id is always a new chat.
  useEffect(() => {
    if (id) {
      if (id !== activeId) setActiveId(id)
    } else if (activeId) {
      setActiveId(null)
    }
  }, [id, activeId])

  useEffect(() => {
    if (import.meta.env.DEV) console.log('[DEV /chat/:id]', { id: id ?? null, activeId, historyLoaded, messagesCount: messages.length, messages })
  }, [id, activeId, historyLoaded, messages])

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
    if (import.meta.env.DEV) console.log('[DEV /chat/:id] loading conversation', activeId)
    getMessagesPage(activeId, { limit: 30 })
      .then(({ messages: msgs, hasMore: hm, oldestPosition, total }) => {
        if (cancelled) return
        if (import.meta.env.DEV) console.log('[DEV /chat/:id] conversation detail', { convId: activeId, count: msgs.length, hasMore: hm, oldestPosition, total, messages: msgs })
        setMessages(msgs)
        setHasMore(hm)
        setOldestPos(oldestPosition)
        setHistoryLoaded(true)
      })
      .catch((e) => {
        if (cancelled) return
        if (import.meta.env.DEV) console.log('[DEV /chat/:id] conversation load failed', activeId, e)
        setHistoryLoaded(false)
        setAttachError('Could not load conversation history. Reopen this chat to retry.')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const loadMore = async () => {
    if (!activeId || !hasMore || pagingRef.current || busy || oldestPos == null) return
    const route = id
    const operation = operationRef.current
    pagingRef.current = true
    setLoadingMore(true)
    const container = scrollRef.current
    const prevHeight = container?.scrollHeight ?? 0
    const prevTop = container?.scrollTop ?? 0
    try {
      const page = await getMessagesPage(activeId, { limit: 30, before: oldestPos })
      if (routeRef.current !== route || operation !== operationRef.current) return
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
      if (operation === operationRef.current) { pagingRef.current = false; setLoadingMore(false) }
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
  }, [hasMore, historyLoaded, oldestPos, activeId, busy])


  useEffect(() => {
    api
      .me()
      .then((me) => setFreeTier(!me.is_member && !me.is_owner && !me.is_paid))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchLimits = (force = false) => {
      api.getUsageLimits(force).then((l: any) => {
        if (cancelled) return
        setDailyUsed(typeof l.daily_used === 'number' ? l.daily_used : null)
        setDailyLimit(typeof l.daily_limit === 'number' ? l.daily_limit : null)
      }).catch(() => {})
    }
    fetchLimits()
    const iv = window.setInterval(() => fetchLimits(), 5 * 60 * 1000)
    return () => { cancelled = true; window.clearInterval(iv) }
  }, [])

  useEffect(() => {
    if (!busy) {
      api.getUsageLimits().then((l: any) => {
        setDailyUsed(typeof l.daily_used === 'number' ? l.daily_used : null)
        setDailyLimit(typeof l.daily_limit === 'number' ? l.daily_limit : null)
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy === false ? 'idle' : 'busy'])

  const isDailyExceeded = dailyLimit != null && dailyUsed != null && dailyUsed >= dailyLimit

  useEffect(() => {
    if (!sessionToken) { setModelsLoading(false); return }
    setModelsLoading(true)
    fetch('/v1/models', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((r) => { if (!r.ok) throw new Error('Could not load models.'); return r.json() })
      .then((d) => {
        const list = (d?.data || []).map((m: { id: string }) => m.id)
        let filtered = list.filter((id: string) => ALLOWED_CHAT_MODELS.has(id))
        if (!filtered.includes('z-image-turbo') && ALLOWED_CHAT_MODELS.has('z-image-turbo')) {
          filtered = [...filtered, 'z-image-turbo']
        }
        if (!filtered.includes('glm-image') && ALLOWED_CHAT_MODELS.has('glm-image')) {
          filtered = [...filtered, 'glm-image']
        }
        const toShow = filtered.filter((id: string) => ALLOWED_CHAT_MODELS.has(id))
        if (toShow.length) {
          setModels(toShow)
          setModel((cur) =>
            cur && toShow.includes(cur) ? cur : toShow.includes('qwen3.8-flash') ? 'qwen3.8-flash' : toShow.find((id: string) => id.includes('flash')) || toShow[0]
          )
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
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

  // Scroll only the chat viewport; scrollIntoView also moves ancestor scrollers.
  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container || !historyLoaded || !stickToBottomRef.current || pagingRef.current) return
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  }, [messages, historyLoaded])

  useEffect(() => {
    resizeTextarea()
  }, [input])

  const addFiles = async (files: File[]) => {
    if (!files.length || attaching || sendingRef.current) return
    const route = id
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
    if (routeRef.current !== route) { setAttaching(false); return }
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

  const onPasteFiles = async (e: React.ClipboardEvent) => {
    const files: File[] = []
    const items = e.clipboardData?.items
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f && (f.type.startsWith('image/') || f.size > 0)) files.push(f)
        }
      }
    }
    if (!files.length && e.clipboardData?.files?.length) {
      files.push(...Array.from(e.clipboardData.files))
    }
    if (!files.length) return
    e.preventDefault()
    await addFiles(files)
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

  const send = async (textOverride?: string, opts?: { skipConfirm?: boolean }) => {
    if (sendingRef.current || pagingRef.current || compacting || attaching || !historyLoaded || activeId !== (id ?? null)) return
    if (isDailyExceeded) { setUpgradeOpen(true); return }
    const text = (textOverride ?? input).trim()
    const attachments = [...pending]
    if (!text && !attachments.length) return
    if (!sessionToken || !model) {
      setAttachError(!sessionToken ? 'Log in to start chatting.' : 'No model is available right now.')
      return
    }
    const requestModel = freeTier && !model.includes('flash') ? 'deepseek-v4-flash' : model
    const doImageGen = imageGen || ['z-image-turbo', 'glm-image', 'grok-imagine-image'].includes(requestModel)
    // ถามก่อนใช้ tool ที่เปิดเองแบบ explicit เท่านั้น
    // ส่วนว่าข้อความคลุมเครือไหม / ต้องถามเพิ่มไหม -> ให้ model ตัดสินใจเอง
    // (backend ฉีด clarify system prompt; model จะถามกลับมาเป็นข้อความปกติ)
    if (askFirst && !opts?.skipConfirm) {
      if (doImageGen) {
        setPendingText(textOverride)
        setConfirm({ kind: 'image', title: 'สร้างรูปใช่ไหม?', detail: `“${text.slice(0, 140)}” จะใช้ image tool (มีค่าใช้จ่าย/ใช้เวลา) ยืนยันก่อนทำไหม?` })
        return
      }
      if (webSearch) {
        setPendingText(textOverride)
        setConfirm({ kind: 'search', title: 'ค้นเว็บใช่ไหม?', detail: `“${text.slice(0, 140)}” จะค้นเว็บก่อนตอบ ยืนยันก่อนทำไหม?` })
        return
      }
    }
    sendingRef.current = true
    setBusy(true)
    stickToBottomRef.current = true
    const operation = ++operationRef.current
    const route = id
    const current = () => operationRef.current === operation && routeRef.current === route
    const controller = new AbortController()
    abortRef.current = controller
    const deadline = streamDeadline(controller)
    const startedAt = performance.now()
    const userMsg: Msg = { role: 'user', content: text, attachments, model: requestModel }
    let assistant: Msg = { role: 'assistant', content: '', reasoning: '', model: requestModel }
    let displayed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = () => {
      clearTimeout(timer)
      timer = undefined
      if (!current()) return
      const snapshot = { ...assistant }
      setMessages((prev) => current() ? [...prev.slice(0, -1), snapshot] : prev)
    }
    const schedule = () => { if (!timer) timer = setTimeout(publish, 48) }
    try {
      let requestHistory = contextRef.current ?? messages
      if (!doImageGen && nearLimit && requestHistory.length >= 3) {
        const summary = await compactChat(true, controller)
        if (!summary || !current()) return
        requestHistory = summary
      }
      if (!current()) return
      setInput('')
      setPending([])
      setMessages((prev) => [...prev, userMsg, { ...assistant }])
      displayed = true
      setIsVision(attachments.some((a) => a.kind !== 'text'))
      setBusyIsImage(doImageGen)
      const history = requestHistory.filter((m) => !m.error && (m.content || m.attachments?.length)).map((m) => ({
        role: m.role, content: m.role === 'user' ? buildContent(m.content, m.attachments ?? []) : m.content,
      }))
      const body: Record<string, unknown> = {
        model: requestModel, max_tokens: maxTokens, stream: true,
        messages: [...(doImageGen ? [] : history), { role: 'user', content: buildContent(text, attachments) }],
        reasoning: { effort: thinking ? effort : 'none' },
        ...(thinking ? { output_config: { effort } } : {}),
        ...(doImageGen ? { image_gen: true } : {}),
        ...(webSearch ? { web_search: true } : {}),
        ...(askFirst ? { require_confirm: true } : {}),
        ...(opts?.skipConfirm ? { confirmed: true } : {}),
      }
      const res = await fetch('/api/web/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body), signal: controller.signal,
      })
      deadline.touch()
      if (!res.ok) {
        const err = friendlyError(res, await res.text(), membersUrl)
        assistant = { ...assistant, ...err, error: true }
      } else {
        await consumeStream(res, controller, deadline.touch,
          (content) => { assistant.content += content; schedule() },
          (reasoning) => { if (thinking) { assistant.reasoning += reasoning; schedule() } },
          (meta) => { assistant = { ...assistant, ...meta } })
        if (!assistant.content && !assistant.reasoning) throw new Error('The model returned an empty response.')
      }
    } catch (err) {
      const stopped = controller.signal.aborted && !deadline.expired()
      const detail = deadline.expired() ? 'Response timed out. Please try again.'
        : stopped ? 'Stopped.' : `Something went wrong. ${err instanceof Error ? err.message : String(err)}`
      assistant = { ...assistant,
        content: assistant.content ? `${assistant.content}\n\n${detail}` : detail,
        error: !stopped,
      }
    } finally {
      deadline.dispose()
      clearTimeout(timer)
      assistant.durationMs = Math.round(performance.now() - startedAt)
      if (displayed && current()) {
        publish()
        if (contextRef.current) contextRef.current = [...contextRef.current, userMsg, assistant]
        try {
          if (activeId) {
            const inserted = await appendMessages(activeId, [userMsg, assistant])
            if (current() && Array.isArray(inserted) && inserted.length === 2) {
              setMessages((prev) => current() ? [...prev.slice(0, -2),
                { ...userMsg, id: inserted[0]?.id }, { ...assistant, id: inserted[1]?.id }] : prev)
            }
          } else {
            const newId = await saveConversation(null, [...messages, userMsg, assistant], requestModel)
            if (current() && newId) navigate(`/chat/${newId}`, { replace: true })
          }
        } catch {
          if (current()) setAttachError('Could not save this response. Copy it before leaving this chat.')
        }
      }
      if (current()) {
        sendingRef.current = false
        setBusy(false)
        setIsVision(false)
        setBusyIsImage(false)
        abortRef.current = null
      }
    }
  }

  const stop = () => abortRef.current?.abort()

  const copyMsg = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(content)
      setTimeout(() => setCopied(null), 1500)
    } catch { setAttachError('Could not copy. Please select and copy the text manually.') }
  }

  const reactMsg = async (idx: number, reaction: 'like' | 'dislike') => {
    const msg = messages[idx]
    if (!msg || msg.role !== 'assistant') return
    const convId = activeId
    const msgId = msg.id
    const next: 'like' | 'dislike' | null = msg.reaction === reaction ? null : reaction
    setMessages((prev) => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], reaction: next }
      return copy
    })
    if (!convId || !msgId) return
    try {
      const res = await api.reactMessage(convId, msgId, next)
      setMessages((prev) => {
        const copy = [...prev]
        if (copy[idx]?.id === msgId) copy[idx] = { ...copy[idx], reaction: res.reaction ?? null }
        return copy
      })
    } catch {
      setMessages((prev) => {
        const copy = [...prev]
        if (copy[idx]?.id === msgId) copy[idx] = { ...copy[idx], reaction: msg.reaction ?? null }
        return copy
      })
    }
  }

  const clearChat = () => {
    operationRef.current += 1
    stop()
    sendingRef.current = false
    contextRef.current = null
    setBusy(false)
    setCompacting(false)
    setInput('')
    setPending([])
    setBusyIsImage(false)
    setMessages([])
    setActiveId(null)
    navigate('/chat')
    setHistoryLoaded(true)
  }

  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT
  const usedTokens = estimateMessagesTokens(contextRef.current ?? messages)
  const usageRatio = contextLimit > 0 ? usedTokens / contextLimit : 0
  const nearLimit = usageRatio >= COMPACT_THRESHOLD

  // Keep compaction as request context; never replace a partially loaded archive.
  const compactChat = async (fromSend = false, parentController?: AbortController): Promise<Msg[] | null> => {
    if ((!fromSend && sendingRef.current) || pagingRef.current || compacting || !sessionToken || messages.length < 3) return null
    const operation = operationRef.current
    const route = id
    const current = () => operation === operationRef.current && routeRef.current === route
    const controller = parentController ?? new AbortController()
    if (!parentController) { abortRef.current = controller; sendingRef.current = true }
    const deadline = streamDeadline(controller)
    setCompacting(true)
    try {
      const history = (contextRef.current ?? messages).filter((m) => !m.error).map((m) => ({
        role: m.role, content: m.role === 'user' ? buildContent(m.content, m.attachments ?? []) : m.content,
      }))
      const res = await fetch('/api/web/chat/compact', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ model, messages: history }), signal: controller.signal,
      })
      if (!res.ok) throw new Error('Could not compact this conversation.')
      const data = await res.json()
      const summary = typeof data?.summary === 'string' ? data.summary.trim() : ''
      if (!summary) throw new Error('The summary was empty.')
      if (!current()) return null
      const result: Msg[] = [{ role: 'user', content: `[Summary of earlier conversation]\n\n${summary}`, model }]
      contextRef.current = result
      return result
    } catch {
      if (current()) setAttachError('Could not compact this conversation. Please try again.')
      return null
    } finally {
      deadline.dispose()
      if (current()) {
        setCompacting(false)
        if (!parentController) { sendingRef.current = false; abortRef.current = null }
      }
    }
  }

  // A continuation is an appended turn, preserving unloaded messages and their IDs.
  const handleContinue = () => {
    const last = messages[messages.length - 1]
    if (pending.length) { setAttachError('Send or remove pending attachments before continuing.'); return }
    if (last?.role === 'assistant' && !last.error && isTruncated(last)) void send('continue')
  }

  const isEmpty = messages.length === 0

  return (
    <>
      <style>{`@keyframes slide { 0%{transform:translateX(0)} 20%{transform:translateX(0)} 80%{transform:translateX(calc(-100% + 100px))} 100%{transform:translateX(calc(-100% + 100px))} }`}</style>
    <div className="flex flex-col flex-1 min-h-0 -mx-4 sm:mx-0 -mt-4 sm:mt-0">
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-1 pt-2 sm:pt-0 shrink-0">
        <button
          onClick={clearChat}
          className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          title="New chat"
        >
          <FiPlus size={18} />
        </button>
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 justify-center">
          <div ref={modelRef} className="relative min-w-0 max-w-[60vw] sm:max-w-none">
            <button
              onClick={() => !modelsLoading && setModelOpen((o) => !o)}
              disabled={modelsLoading}
              className="flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 sm:px-4 text-xs sm:text-sm text-zinc-300 hover:bg-zinc-800 transition-colors min-w-0 max-w-full disabled:opacity-60"
            >
              {modelsLoading ? (
                <>
                  <span className="size-2 rounded-full bg-zinc-700 animate-pulse shrink-0" />
                  <Skeleton className="h-3 w-24 bg-zinc-800" />
                  <FiChevronDown size={12} className="shrink-0 text-zinc-600" />
                </>
              ) : (
                <>
                  <span className="size-2 rounded-full bg-(--primary-color) shrink-0" />
                  <span className="truncate font-medium min-w-0">{MODEL_META[model]?.name ?? model}</span>
                  <FiChevronDown size={12} className={`shrink-0 transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>
            {modelOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 top-full z-50 mt-2 w-[calc(100vw-1.5rem)] sm:w-72 max-w-[22rem] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 py-1.5 shadow-xl">
              <div className="max-h-[60vh] sm:max-h-100 overflow-y-auto overscroll-contain">
              {modelsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex w-full items-start gap-3 px-4 py-2.5">
                    <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-800" />
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-3/5 bg-zinc-800" />
                      <span className="flex gap-1">
                        <Skeleton className="h-3 w-8 rounded-full bg-zinc-800" />
                        <Skeleton className="h-3 w-10 rounded-full bg-zinc-800" />
                      </span>
                      <Skeleton className="h-3 w-full bg-zinc-800" />
                      <Skeleton className="h-2 w-24 bg-zinc-800" />
                    </span>
                  </div>
                ))
              ) : (
                models.map((m) => {
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
                    {m === model && <FiCheck size={14} className="mt-1 text-(--primary-color) shrink-0" />}
                  </button>
                )
              }))}
              </div>
            </div>
          )}
          </div>
          <button
            onClick={() => setUpgradeOpen(true)}
            className="hidden sm:inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-(--primary-color) px-3 text-xs font-medium text-(--primary-foreground) transition-opacity hover:opacity-90"
          >
            <FiZap size={12} />
            Upgrade
          </button>
          <button
            onClick={() => setUpgradeOpen(true)}
            className="sm:hidden flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground)"
            title="Upgrade"
          >
            <FiZap size={14} />
          </button>
        </div>
        <div className="w-9 sm:w-10 shrink-0" />
      </div>

      <div ref={scrollRef} onScroll={(e) => { const el = e.currentTarget; stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} className="relative flex-1 overflow-y-auto min-h-0 overscroll-contain [overflow-anchor:none]">
        {!historyLoaded ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
            <IOSLoading size={40} />
            <p className="text-sm text-zinc-500">Loading conversation…</p>
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-6 sm:gap-8 px-4 pb-10 pt-6">
            <h1 className="text-center text-xl sm:text-3xl font-medium text-zinc-100 px-2">
              What can I help with?
            </h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 w-full max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl sm:rounded-2xl border border-zinc-800 bg-zinc-900/50 px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs sm:text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors leading-relaxed"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-3 sm:px-4 py-4 sm:py-6 space-y-6 sm:space-y-8">
            <div ref={topSentinelRef} className="h-px" />
            {loadingMore && <div className="flex justify-center py-2 text-xs text-zinc-500">Loading older messages…</div>}
            {!hasMore && messages.length > 0 && <div className="text-center text-xs text-zinc-600">Beginning of conversation</div>}
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2.5 sm:gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className="shrink-0">
                  {m.role === 'assistant' ? (
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-xs sm:text-sm font-bold">
                      D
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 text-xs sm:text-sm font-semibold">
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
                        <>
                          {m.role === 'assistant' ? (
                            <Markdown>{m.content}</Markdown>
                          ) : (
                            <div className="whitespace-pre-wrap">{m.content}</div>
                          )}
                        </>
                      ) : null}
                      {m.role === 'assistant' && busy && i === messages.length - 1 && !m.error && (
                        <div className="mt-2 min-h-6">
                          {busyIsImage ? (
                            !m.content ? <ImageGenLoading /> : null
                          ) : (
                            <AILoader
                              className="text-zinc-400"
                              label={isVision ? 'Looking at the image…' : thinking ? 'Reasoning…' : 'Generating…'}
                              variant="dots"
                              showElapsed
                            />
                          )}
                        </div>
                      )}
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
                        onClick={() => reactMsg(i, 'like')}
                        disabled={!activeId || !m.id}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${m.reaction === 'like' ? 'bg-zinc-800 text-green-500' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                        title={m.id ? 'Good response' : 'Save conversation to react'}
                      >
                        <FiThumbsUp size={14} className={m.reaction === 'like' ? 'fill-current' : ''} />
                      </button>
                      <button
                        onClick={() => reactMsg(i, 'dislike')}
                        disabled={!activeId || !m.id}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${m.reaction === 'dislike' ? 'bg-zinc-800 text-red-500' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                        title={m.id ? 'Bad response' : 'Save conversation to react'}
                      >
                        <FiThumbsDown size={14} className={m.reaction === 'dislike' ? 'fill-current' : ''} />
                      </button>
                    </div>
                  )}
                  {m.role === 'assistant' && i === messages.length - 1 && !m.error && isTruncated(m) && !busy && !compacting && (
                    <button
                      onClick={handleContinue}
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
          </div>
        )}
      </div>

      {isDailyExceeded && (
        <div className="mx-auto w-full max-w-3xl px-2 sm:px-4 pt-2 shrink-0">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 backdrop-blur">
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-200">Daily limit reached</p>
              <p className="text-xs text-amber-200/70 truncate">{(dailyUsed ?? 0).toLocaleString()} / {(dailyLimit ?? 0).toLocaleString()} tokens used — resets in 24h</p>
            </div>
            <button onClick={() => setUpgradeOpen(true)} className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors">
              <FiZap size={12} /> Upgrade
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl px-2 sm:px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-0 pt-2 shrink-0">
        <div
          className={`rounded-[20px] sm:rounded-[26px] border bg-zinc-900 shadow-[0_4px_20px_rgba(0,0,0,0.4)] transition-colors ${
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
          <div className="flex items-end gap-1.5 sm:gap-2 px-2 sm:px-3 py-2">
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
              onPaste={onPasteFiles}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder={isDailyExceeded ? "Daily limit reached — upgrade to continue" : "Ask anything"}
              disabled={isDailyExceeded}
              className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[16px] sm:text-[15px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-50"
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
                disabled={!historyLoaded || busy || compacting || isDailyExceeded || (!input.trim() && pending.length === 0) || attaching}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
                title={isDailyExceeded ? "Daily limit reached" : "Send message"}
              >
                <FiSend size={15} className="-mr-0.5" />
              </button>
            )}
          </div>
        </div>
        {attachError && <p className="mt-1 text-center text-xs text-red-400 px-2">{attachError}</p>}
        <TooltipProvider>
        <div className="mt-2 flex items-start gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { void compactChat() }}
                disabled={busy || compacting || !historyLoaded}
                className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 mt-0.5"
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
            </TooltipTrigger>
            <TooltipContent side="top">{nearLimit ? 'Context nearly full — click to compact conversation' : `Context ${Math.round(usageRatio * 100)}% used (${usedTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens) — click to compact`}</TooltipContent>
          </Tooltip>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pb-1 -mx-1 px-1">
              <Tooltip>
                <TooltipTrigger asChild>
              <button
                onClick={() => setThinking((t) => !t)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors whitespace-nowrap ${
                  thinking
                    ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
                  >
                    <FiZap size={12} />
                    {thinking ? 'Thinking On' : 'Thinking Off'}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{thinking ? 'Thinking enabled — model shows reasoning steps' : 'Enable thinking to see model reasoning'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
              <button
                onClick={() => setImageGen((v) => !v)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors whitespace-nowrap ${
                  imageGen
                    ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
                  >
                    <FiImage size={12} />
                    Image Gen
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{imageGen ? 'Image generation on — prompt will generate images' : 'Toggle image generation for this prompt'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
              <button
                onClick={() => setWebSearch((v) => !v)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors whitespace-nowrap ${
                  webSearch
                    ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
                  >
                    <FiSearch size={12} />
                    Web Search
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{webSearch ? 'Web search enabled — model can browse' : 'Enable web search for up-to-date answers'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
              <button
                onClick={() => setAskFirst((v) => !v)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors whitespace-nowrap ${
                  askFirst
                    ? 'border-(--primary-color)/50 bg-(--primary-color)/10 text-(--primary-color)'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
                  >
                    <FiClock size={12} />
                    {askFirst ? 'ถามก่อนทำ On' : 'ถามก่อนทำ Off'}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{askFirst ? 'ถามยืนยันก่อนใช้ tool / ถามกลับเมื่อคลุมเครือ' : 'ส่งทันทีโดยไม่ถามยืนยัน'}</TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-0.5 rounded-full border border-zinc-700 bg-zinc-800 p-0.5 shrink-0">
                {([1024, 2048, 4096, 8192] as const).map((v) => (
                  <Tooltip key={v}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setMaxTokens(v)}
                        className={`h-7 rounded-full px-2.5 text-xs tabular-nums transition-colors ${maxTokens === v ? 'bg-zinc-100 text-black shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {v >= 1024 ? `${v / 1024}k` : v}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Max output {v.toLocaleString()} tokens — larger = longer response</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {thinking && (
                  <motion.div
                    key="effort-inline"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="hidden sm:flex items-center gap-1 shrink-0 overflow-hidden"
                  >
                    <div className="flex items-center gap-0.5 rounded-full border border-zinc-700 bg-zinc-800 p-0.5 shrink-0">
                      {(['low', 'high', 'max'] as const).map((e) => (
                        <Tooltip key={e}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setEffort(e)}
                              className={`h-7 rounded-full px-3 text-xs capitalize transition-colors ${effort === e ? 'bg-(--primary-color) text-(--primary-foreground) shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                              {e}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{e === 'low' ? 'Low effort — faster, lighter reasoning' : e === 'high' ? 'High effort — deeper reasoning' : 'Max effort — most thorough reasoning'}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
              {thinking && (
                <motion.div
                  key="effort-below"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="overflow-hidden sm:hidden"
                >
                  <div className="pt-1.5 flex items-center gap-2">
                    <span className="text-[11px] font-medium tracking-wide text-zinc-500 shrink-0">Effort</span>
                    <div className="flex items-center gap-0.5 rounded-full border border-zinc-700 bg-zinc-800 p-0.5">
                      {(['low', 'high', 'max'] as const).map((e) => (
                        <Tooltip key={e}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setEffort(e)}
                              className={`h-7 rounded-full px-3.5 text-xs capitalize transition-colors ${effort === e ? 'bg-(--primary-color) text-(--primary-foreground) shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                              {e}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{e === 'low' ? 'Low effort — faster' : e === 'high' ? 'High effort — deeper' : 'Max effort — most thorough'}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        </TooltipProvider>
        <p className="mt-2 text-center text-xs text-zinc-600">
          Model can make mistakes. Check important info.
        </p>
    </div>
    </div>

    <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      {confirm && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => { setConfirm(null); setPendingText(undefined) }}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100">{confirm.title}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{confirm.detail}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => { const t = pendingText; setConfirm(null); setPendingText(undefined); void send(t, { skipConfirm: true }) }}
                className="h-10 rounded-full bg-(--primary-color) text-sm font-semibold text-(--primary-foreground) hover:opacity-90"
              >
                ยืนยัน ทำเลย
              </button>
              <button
                onClick={() => { setConfirm(null); setPendingText(undefined); textareaRef.current?.focus() }}
                className="h-10 rounded-full border border-zinc-700 bg-zinc-800 text-sm text-zinc-200 hover:bg-zinc-700"
              >
                แก้ไขก่อน
              </button>
              <button
                onClick={() => { setConfirm(null); setPendingText(undefined) }}
                className="h-10 rounded-full text-sm text-zinc-500 hover:text-zinc-300"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
