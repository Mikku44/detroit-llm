import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Checkbox } from './ui/checkbox'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'

const CONSENT_KEY = 'dlg_legal_consent_v1'
const LANG_KEY = 'dlg_legal_lang'

export function recordLegalConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, 'accepted')
  } catch {
    /* ignore */
  }
}

type Step = 'terms' | 'privacy'
type Lang = 'th' | 'en'

const LANG_LABELS: Record<Lang, string> = { th: 'ไทย', en: 'EN' }

const COPY: Record<Lang, Record<string, string>> = {
  th: {
    step1: '1 / 2',
    step2: '2 / 2',
    desc: 'โปรดอ่านและยอมรับก่อนดำเนินการเข้าสู่ระบบ',
    termsTitle: 'Terms of Use',
    privacyTitle: 'Privacy Policy',
    acceptLabel: 'ฉันได้อ่านและยอมรับ',
    cancel: 'ยกเลิก',
    continue: 'ต่อไป',
    acceptAndSignIn: 'ฉันยอมรับและเข้าสู่ระบบ',
    loading: 'กำลังโหลด...',
  },
  en: {
    step1: '1 of 2',
    step2: '2 of 2',
    desc: 'Please review and accept before continuing to sign in.',
    termsTitle: 'Terms of Use',
    privacyTitle: 'Privacy Policy',
    acceptLabel: 'I have read and I accept the',
    cancel: 'Cancel',
    continue: 'Continue',
    acceptAndSignIn: 'I Accept & Sign In',
    loading: 'Loading...',
  },
}

export default function LoginConsentModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [step, setStep] = useState<Step>('terms')
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem(LANG_KEY) as Lang) || 'th'
    } catch {
      return 'th'
    }
  })
  const [termsText, setTermsText] = useState('')
  const [privacyText, setPrivacyText] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setStep('terms')
      setTermsAccepted(false)
      setPrivacyAccepted(false)
      const langSuffix = lang === 'en' ? '-en' : ''
      fetch(`/terms-of-use${langSuffix}.md`)
        .then((r) => (r.ok ? r.text() : ''))
        .then(setTermsText)
        .catch(() => setTermsText(''))
      fetch(`/privacy-policy${langSuffix}.md`)
        .then((r) => (r.ok ? r.text() : ''))
        .then(setPrivacyText)
        .catch(() => setPrivacyText(''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lang])

  const switchLang = (next: Lang) => {
    setLang(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const handleContinue = () => {
    if (step === 'terms') {
      setStep('privacy')
    } else {
      // Record consent, then redirect to Google/YouTube OAuth sign-in.
      recordLegalConsent()
      onOpenChange(false)
      setLoading(true)
      window.location.href = api.userLoginUrl()
    }
  }

  const isCurrentAccepted = step === 'terms' ? termsAccepted : privacyAccepted
  const t = COPY[lang]
  const title = step === 'terms' ? t.termsTitle : t.privacyTitle
  const body = step === 'terms' ? termsText : privacyText

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              {title}
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                {step === 'terms' ? t.step1 : t.step2}
              </span>
            </DialogTitle>
            <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 p-0.5">
              {(['th', 'en'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => switchLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    lang === l
                      ? 'bg-(--primary-color) text-(--primary-foreground)'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {LANG_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm leading-6 text-zinc-300 prose prose-invert prose-zinc max-w-none prose-headings:text-zinc-100 prose-headings:text-base prose-headings:font-semibold prose-p:text-sm prose-li:text-sm">
          {body ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          ) : (
            <p className="text-zinc-500">{t.loading}</p>
          )}
        </div>

        <label className="mt-2 flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
          <div className="pt-0.5">
            <Checkbox
              checked={isCurrentAccepted}
              onCheckedChange={(v) => {
                if (step === 'terms') setTermsAccepted(v === true)
                else setPrivacyAccepted(v === true)
              }}
              aria-label={`I accept the ${title}`}
            />
          </div>
          <span className="text-sm text-zinc-300">
            {t.acceptLabel} <span className="font-medium text-zinc-100">{title}</span>.
          </span>
        </label>

        <DialogFooter className="gap-2 sm:space-x-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-zinc-200">
            {t.cancel}
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!isCurrentAccepted || loading}
            className="bg-(--primary-color) hover:bg-(--primary-color-hover) text-(--primary-foreground) border-transparent disabled:opacity-50"
          >
            {step === 'terms' ? t.continue : t.acceptAndSignIn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
