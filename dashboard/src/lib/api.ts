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

  verifyPhone: (phoneNumber: string) =>
    request('/admin/me/phone', { method: 'POST', body: JSON.stringify({ phone_number: phoneNumber }) }),

  listKeys: () => request('/admin/keys'),
  createKey: (name: string = 'default', expires_at?: string) =>
    request('/admin/keys', { method: 'POST', body: JSON.stringify({ name, expires_at }) }),
  revokeKey: (keyId: string) =>
    request(`/admin/keys/${keyId}`, { method: 'DELETE' }),

  getUsage: (days: number = 7) => request(`/admin/usage?days=${days}`),

  getUsagePunchcard: (days: number = 7) => request(`/admin/usage/punchcard?days=${days}`),

  getUsageModels: (days: number = 7) => request(`/admin/usage/models?days=${days}`),

  getUsageLimits: () => request('/admin/usage/limits'),

  getPayments: () => request('/admin/payments'),

  createCheckout: (tierId: string, paymentMethod: string = 'card') => request('/stripe/checkout', { method: 'POST', body: JSON.stringify({ tier_id: tierId, payment_method: paymentMethod }) }),

  checkoutStatus: (sessionId: string) => request(`/stripe/checkout/${sessionId}`),

  getSubscription: () => request('/stripe/subscription'),

  cancelSubscription: () => request('/stripe/subscription/cancel', { method: 'POST' }),

  listUsers: () => request('/admin/users'),

  setUserVerified: (userId: string, isVerified: boolean) =>
    request(`/admin/users/${userId}/verify`, { method: 'POST', body: JSON.stringify({ is_verified: isVerified }) }),

  status: () => request('/admin/status'),
  getBalances: () => request('/admin/balances'),

  verifyMembers: () => request('/auth/youtube/verify-members', { method: 'POST' }),

  youtubeMembersStatus: () => request('/auth/youtube/status'),

  getStoredMembers: () => request('/auth/youtube/members'),
  setStoredMembers: (payload: any) => request('/auth/youtube/members', { method: 'POST', body: JSON.stringify(payload) }),
  clearStoredMembers: () => request('/auth/youtube/members', { method: 'DELETE' }),

  setStoredLevels: (payload: any) => request('/auth/youtube/levels', { method: 'POST', body: JSON.stringify(payload) }),

  listConversations: (params: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.offset) q.set('offset', String(params.offset))
    const qs = q.toString() ? `?${q}` : ''
    return request(`/api/conversations${qs}`)
  },
  getConversation: (id: string, params: { limit?: number; before?: number; all?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.before != null) q.set('before', String(params.before))
    if (params.all) q.set('all', 'true')
    const qs = q.toString() ? `?${q}` : ''
    return request(`/api/conversations/${id}${qs}`)
  },
  getConversationMessages: (id: string, params: { limit?: number; before?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.before != null) q.set('before', String(params.before))
    const qs = q.toString() ? `?${q}` : ''
    return request(`/api/conversations/${id}/messages${qs}`)
  },
  appendMessages: (id: string, messages: any[]) => request(`/api/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ messages }) }),
  createConversation: (data: any) => request('/api/conversations', { method: 'POST', body: JSON.stringify(data) }),
  updateConversation: (id: string, data: any) => request(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteConversation: (id: string) => request(`/api/conversations/${id}`, { method: 'DELETE' }),

  loginUrl: () => `${BASE}/auth/youtube/login?redirect=dashboard`,
  userLoginUrl: () => `${BASE}/auth/youtube/login/user?redirect=dashboard`,
}
