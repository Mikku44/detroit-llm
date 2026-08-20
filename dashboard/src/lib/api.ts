const BASE = ''

function getToken(): string | null {
  return localStorage.getItem('session_token')
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const api = {
  health: () => request('/health'),

  me: () => request('/admin/me'),

  listKeys: () => request('/admin/keys'),
  createKey: (name: string = 'default', expires_at?: string) =>
    request('/admin/keys', { method: 'POST', body: JSON.stringify({ name, expires_at }) }),
  revokeKey: (keyId: string) =>
    request(`/admin/keys/${keyId}`, { method: 'DELETE' }),

  getUsage: (days: number = 7) => request(`/admin/usage?days=${days}`),

  getUsagePunchcard: (days: number = 7) => request(`/admin/usage/punchcard?days=${days}`),

  getUsageModels: (days: number = 7) => request(`/admin/usage/models?days=${days}`),

  listUsers: () => request('/admin/users'),

  verifyMembers: () => request('/auth/youtube/verify-members', { method: 'POST' }),

  listConversations: () => request('/api/conversations'),
  getConversation: (id: string) => request(`/api/conversations/${id}`),
  createConversation: (data: any) => request('/api/conversations', { method: 'POST', body: JSON.stringify(data) }),
  updateConversation: (id: string, data: any) => request(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteConversation: (id: string) => request(`/api/conversations/${id}`, { method: 'DELETE' }),

  loginUrl: () => `${BASE}/auth/youtube/login?redirect=dashboard`,
  userLoginUrl: () => `${BASE}/auth/youtube/login/user?redirect=dashboard`,
}
