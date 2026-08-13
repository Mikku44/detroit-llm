import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

export type Conversation = {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

const HISTORY_KEY = "chat_history"

function loadHistory(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]")
  } catch {
    return []
  }
}

function saveHistory(convs: Conversation[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(convs))
}

type ChatHistoryContextType = {
  conversations: Conversation[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  save: (convId: string, messages: Message[]) => void
  remove: (convId: string) => void
  getMessages: (convId: string) => Message[]
}

const ChatHistoryContext = createContext<ChatHistoryContextType | null>(null)

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>(loadHistory)
  const [activeId, setActiveId] = useState<string | null>(null)

  const save = useCallback((convId: string, msgs: Message[]) => {
    if (msgs.length === 0) return
    const firstUser = msgs.find((m) => m.role === "user")
    const title = firstUser
      ? firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? "..." : "")
      : "New Chat"
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === convId)
      const updated: Conversation = { id: convId, title, messages: msgs, updatedAt: Date.now() }
      let next: Conversation[]
      if (idx >= 0) {
        next = [...prev]
        next[idx] = updated
      } else {
        next = [updated, ...prev]
      }
      saveHistory(next)
      return next
    })
  }, [])

  const remove = useCallback((convId: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== convId)
      saveHistory(next)
      return next
    })
  }, [])

  const getMessages = useCallback((convId: string) => {
    const conv = conversations.find((c) => c.id === convId)
    return conv?.messages || []
  }, [conversations])

  return (
    <ChatHistoryContext.Provider value={{ conversations, activeId, setActiveId, save, remove, getMessages }}>
      {children}
    </ChatHistoryContext.Provider>
  )
}

export function useChatHistory() {
  const ctx = useContext(ChatHistoryContext)
  if (!ctx) throw new Error("useChatHistory must be used within ChatHistoryProvider")
  return ctx
}
