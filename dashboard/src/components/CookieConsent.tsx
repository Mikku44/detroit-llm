import { useCallback, useEffect, useState } from 'react'
import { Cookie, X } from 'lucide-react'
import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE_NAME,
  DEFAULT_CONSENT,
  getConsent,
  hasConsented,
  setConsentCookie,
  type ConsentCategory,
  type ConsentState,
} from '../lib/cookie-consent'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'

export function openCookiePreferences() {
  window.dispatchEvent(new CustomEvent('open-cookie-preferences'))
}

export default function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [prefs, setPrefs] = useState<ConsentState>(DEFAULT_CONSENT)

  useEffect(() => {
    if (!hasConsented()) setShowBanner(true)
  }, [])

  useEffect(() => {
    const handler = () => {
      setPrefs(getConsent() ?? DEFAULT_CONSENT)
      setPreferencesOpen(true)
    }
    window.addEventListener('open-cookie-preferences', handler)
    return () => window.removeEventListener('open-cookie-preferences', handler)
  }, [])

  const saveAndClose = useCallback((state: ConsentState) => {
    setConsentCookie(state)
    setShowBanner(false)
    setPreferencesOpen(false)
  }, [])

  const acceptAll = useCallback(() => {
    saveAndClose({ ...DEFAULT_CONSENT, analytics: true, marketing: true })
  }, [saveAndClose])

  const rejectAll = useCallback(() => {
    saveAndClose({ ...DEFAULT_CONSENT })
  }, [saveAndClose])

  const openCustomize = useCallback(() => {
    setPrefs(getConsent() ?? DEFAULT_CONSENT)
    setPreferencesOpen(true)
  }, [])

  const toggleCategory = (id: ConsentCategory) => {
    setPrefs((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      {showBanner && !preferencesOpen && (
        <div className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-3xl rounded-2xl border border-zinc-700/60 bg-zinc-900/95 p-5 shadow-2xl backdrop-blur md:left-auto">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
              <Cookie size={18} />
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-zinc-100">We use cookies</p>
              <p className="text-[13px] leading-6 text-zinc-400">
                We use cookies and similar technologies to keep you signed in, remember your
                preferences, and improve the service. You can accept all, reject non-essential
                cookies, or customize your choices at any time.
              </p>
            </div>
            <button
              onClick={rejectAll}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={openCustomize} className="dark:text-zinc-200">
              Customize
            </Button>
            <Button variant="outline" onClick={rejectAll} className="dark:text-zinc-200">
              Reject all
            </Button>
            <Button onClick={acceptAll} className="bg-(--primary-color) hover:bg-(--primary-color-hover) text-(--primary-foreground) border-transparent">
              Accept all
            </Button>
          </div>
        </div>
      )}

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Choose which cookies we may set. Your choice is stored in the{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs">{CONSENT_COOKIE_NAME}</code>{' '}
              cookie and you can change it anytime.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {CONSENT_CATEGORIES.map((cat) => (
              <label
                key={cat.id}
                className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 transition-colors hover:bg-zinc-900"
              >
                <div className="pt-0.5">
                  <Checkbox
                    checked={prefs[cat.id]}
                    disabled={cat.required}
                    onCheckedChange={() => toggleCategory(cat.id)}
                    aria-label={cat.title}
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                    {cat.title}
                    {cat.required && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                        Always on
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">{cat.description}</p>
                </div>
              </label>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:space-x-2">
            <Button variant="outline" onClick={() => setPreferencesOpen(false)} className="dark:text-zinc-200">
              Cancel
            </Button>
            <Button onClick={() => saveAndClose(prefs)} className="bg-(--primary-color) hover:bg-(--primary-color-hover) text-(--primary-foreground) border-transparent">Save preferences</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
