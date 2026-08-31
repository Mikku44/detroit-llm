import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { api } from './api'

export type Message = {
  id?: string
  role: "user" | "assistant"
  content: string
  reasoning?: string
  error?: boolean
  cta?: { label: string; href: string; external?: boolean }
  attachments?: Array<{ id: string; name: string; kind: 'image' | 'video' | 'text'; dataUrl?: string; text?: string; size: number }>
  model?: string
  durationMs?: number
  finish_reason?: string | null
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  reaction?: 'like' | 'dislike' | null
  like_count?: number
  dislike_count?: number
  position?: number
}

export type Conversation = {
  id: string
  title: string
  updatedAt: number
}

type ChatHistoryContextType = {
  conversations: Conversation[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  save: (convId: string | null, msgs: Message[], model?: string) => Promise<string | null>
  remove: (convId: string) => Promise<void>
  getMessages: (convId: string, opts?: { limit?: number; before?: number }) => Promise<Message[]>
  getMessagesPage: (convId: string, opts?: { limit?: number; before?: number }) => Promise<{ messages: Message[]; hasMore: boolean; oldestPosition: number | null; total: number }>
  appendMessages: (convId: string, msgs: Message[]) => Promise<Message[] | undefined>
  refresh: () => Promise<void>
}

const ChatHistoryContext = createContext<ChatHistoryContextType | null>(null)

function titleFor(msgs: Message[]): string {
  if (msgs.length === 0) return 'New Chat'
  const firstUser = msgs.find((m) => m.role === 'user')
  const base = firstUser ? firstUser.content : 'New Chat'
  return base.slice(0, 60) + (base.length > 60 ? '...' : '')
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.listConversations()
      if (import.meta.env.DEV) console.log('[DEV history] listConversations', d)
      const convs = ((d?.conversations || []) as Array<{ id: string; title?: string; updated_at?: string }>)
        .map((c) => ({
          id: c.id,
          title: c.title || 'New Chat',
          updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
        }))
      if (import.meta.env.DEV) console.log('[DEV history] parsed', convs)
      setConversations(convs)
    } catch (e) {
      if (import.meta.env.DEV) console.log('[DEV history] listConversations failed', e)
      setConversations([])
    }
  }, [])

  const save = useCallback(
    async (convId: string | null, msgs: Message[], model?: string) => {
      if (!msgs || msgs.length === 0) return convId
      const payload = {
        title: titleFor(msgs),
        model: model || undefined,
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
          reasoning: m.reasoning,
          attachments: m.attachments,
          model: m.model,
          usage: m.usage,
          finish_reason: m.finish_reason,
          durationMs: m.durationMs,
        })),
      }
      try {
        if (convId) {
          await api.updateConversation(convId, payload)
          return convId
        }
        const created = await api.createConversation(payload)
        setActiveId(created.id)
        return created.id
      } catch {
        return convId
      } finally {
        refresh()
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (convId: string) => {
      const snapshot = conversations
      const wasActive = activeId === convId
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (wasActive) setActiveId(null)
      try {
        await api.deleteConversation(convId)
      } catch (e) {
        setConversations(snapshot)
        if (wasActive) setActiveId(convId)
        throw e
      } finally {
        await refresh()
      }
    },
    [conversations, activeId, refresh],
  )

  const getMessages = useCallback(async (convId: string, opts: { limit?: number; before?: number } = {}): Promise<Message[]> => {
    try {
      const detail = await api.getConversation(convId, { limit: opts.limit ?? 30, before: opts.before })
      if (import.meta.env.DEV) console.log('[DEV history] getMessages detail', { convId, opts, detail })
      return (detail?.messages || []) as Message[]
    } catch (e) {
      if (import.meta.env.DEV) console.log('[DEV history] getMessages failed', { convId, e })
      return []
    }
  }, [])

  const getMessagesPage = useCallback(async (convId: string, opts: { limit?: number; before?: number } = {}) => {
    const detail = await api.getConversation(convId, { limit: opts.limit ?? 30, before: opts.before })
    if (import.meta.env.DEV) console.log('[DEV history] getConversation detail', { convId, opts, detail })
    return { messages: (detail?.messages || []) as Message[], hasMore: !!detail?.hasMore, oldestPosition: detail?.oldestPosition ?? null, total: detail?.total ?? 0 }
  }, [])

  const appendMessages = useCallback(async (convId: string, msgs: Message[]) => {
    if (import.meta.env.DEV) console.log('[DEV history] appendMessages', { convId, msgs })
    const payload = msgs.map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      attachments: m.attachments,
      model: m.model,
      usage: m.usage,
      finish_reason: m.finish_reason,
      durationMs: m.durationMs,
    }))
    const res = await api.appendMessages(convId, payload)
    if (import.meta.env.DEV) console.log('[DEV history] appendMessages res', res)
    return res?.messages as Message[] | undefined
  }, [])

  return (
    <ChatHistoryContext.Provider value={{ conversations, activeId, setActiveId, save, remove, getMessages, getMessagesPage, appendMessages, refresh }}>
      {children}
    </ChatHistoryContext.Provider>
  )
}

export function useChatHistory() {
  const ctx = useContext(ChatHistoryContext)
  if (!ctx) throw new Error("useChatHistory must be used within ChatHistoryProvider")
  return ctx
}