import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api } from './api'

interface User {
  id: string
  email: string
  display_name: string
  avatar_url?: string
  youtube_channel_id?: string | null
  is_owner: boolean
  is_member: boolean
  is_verified: boolean
  is_paid: boolean
  tier_id?: string | null
  phone_number?: string | null
  created_at?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  setApiKey: (key: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const key = localStorage.getItem('session_token')
    if (key) {
      api.me()
        .then(setUser)
        .catch(() => localStorage.removeItem('session_token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  // Allow components to push fresh user data (e.g. after phone verification).
  useEffect(() => {
    const onUserUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setUser(detail)
    }
    window.addEventListener('auth:user-updated', onUserUpdated)
    return () => window.removeEventListener('auth:user-updated', onUserUpdated)
  }, [])

  const setApiKey = async (key: string) => {
    localStorage.setItem('session_token', key)
    try {
      const u = await api.me()
      setUser(u)
    } catch {
      localStorage.removeItem('session_token')
    }
  }

  const logout = () => {
    localStorage.removeItem('session_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, setApiKey, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
