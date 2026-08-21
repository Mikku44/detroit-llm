export const CONSENT_COOKIE_NAME = 'dlg_consent'

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing'

export interface ConsentState {
  necessary: boolean
  analytics: boolean
  marketing: boolean
  savedAt: string
}

export interface ConsentCategoryInfo {
  id: ConsentCategory
  title: string
  description: string
  required?: boolean
}

export const CONSENT_CATEGORIES: ConsentCategoryInfo[] = [
  {
    id: 'necessary',
    title: 'Strictly Necessary',
    description:
      'Required for the service to work: keeping you signed in, remembering the sidebar state, and protecting against abuse.',
    required: true,
  },
  {
    id: 'analytics',
    title: 'Analytics',
    description:
      'Anonymous usage statistics that help us understand how the app is used and improve it. No personal data is collected.',
  },
  {
    id: 'marketing',
    title: 'Marketing',
    description:
      'Used to deliver relevant updates and offers through third-party channels (e.g. Discord, Facebook).',
  },
]

export const DEFAULT_CONSENT: ConsentState = {
  necessary: true,
  analytics: false,
  marketing: false,
  savedAt: '',
}

function parseConsentCookie(value: string | undefined): ConsentState | null {
  if (!value) return null
  try {
    const raw = JSON.parse(decodeURIComponent(value)) as Partial<ConsentState>
    const state: ConsentState = {
      necessary: raw.necessary !== false,
      analytics: !!raw.analytics,
      marketing: !!raw.marketing,
      savedAt: raw.savedAt || '',
    }
    return state
  } catch {
    return null
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie
    .split('; ')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
  return match ? match.slice(name.length + 1) : undefined
}

export function getConsent(): ConsentState | null {
  return parseConsentCookie(readCookie(CONSENT_COOKIE_NAME))
}

export function setConsentCookie(state: ConsentState, maxAgeDays = 365): void {
  if (typeof document === 'undefined') return
  const value = encodeURIComponent(
    JSON.stringify({ ...state, savedAt: new Date().toISOString() }),
  )
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  const maxAge = maxAgeDays * 24 * 60 * 60
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

export function clearConsentCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${CONSENT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`
}

export function hasConsented(): boolean {
  return getConsent() !== null
}
