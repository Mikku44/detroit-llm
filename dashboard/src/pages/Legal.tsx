import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Markdown from '../components/Markdown'
import PublicNavbar from '../components/PublicNavbar'
import PublicFooter from '../components/PublicFooter'

type Lang = 'th' | 'en'
const LANG_KEY = 'dlg_legal_lang'
const LANG_LABELS: Record<Lang, string> = { th: 'ไทย', en: 'EN' }

function useLegalLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem(LANG_KEY) as Lang | null
      return v === 'en' || v === 'th' ? v : 'th'
    } catch {
      return 'th'
    }
  })
  const setLang = (next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      /* ignore */
    }
  }
  return [lang, setLang]
}

function useMd(path: string) {
  const [text, setText] = useState('Loading...')
  useEffect(() => {
    setText('Loading...')
    fetch(path)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Failed to load.'))
  }, [path])
  return text
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 p-0.5">
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            lang === l ? 'bg-(--primary-color) text-(--primary-foreground)' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  )
}

const COPY = {
  th: {
    back: '← กลับหน้าแรก',
    termsTitle: 'ข้อกำหนดการใช้งาน',
    privacyTitle: 'นโยบายความเป็นส่วนตัว',
    subtitle: 'Detroit LLM',
  },
  en: {
    back: '← Back to home',
    termsTitle: 'Terms of Use',
    privacyTitle: 'Privacy Policy',
    subtitle: 'Detroit LLM',
  },
} as const

export function Terms() {
  const [lang, setLang] = useLegalLang()
  const path = lang === 'en' ? '/terms-of-use-en.md' : '/terms-of-use.md'
  const md = useMd(path)
  const t = COPY[lang]
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <PublicNavbar />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            {t.back}
          </Link>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="mt-4 text-2xl font-serif font-normal text-zinc-50">{t.termsTitle}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {t.termsTitle} — {t.subtitle}
        </p>
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <Markdown>{md}</Markdown>
        </div>
        <div className="mt-4 flex gap-3 text-xs">
          <Link to="/privacy" className="text-zinc-500 hover:text-zinc-300">
            {COPY[lang].privacyTitle} →
          </Link>
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}

export function Privacy() {
  const [lang, setLang] = useLegalLang()
  const path = lang === 'en' ? '/privacy-policy-en.md' : '/privacy-policy.md'
  const md = useMd(path)
  const t = COPY[lang]
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <PublicNavbar />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            {t.back}
          </Link>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="mt-4 text-2xl font-serif font-normal text-zinc-50">{t.privacyTitle}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {t.privacyTitle} — {t.subtitle}
        </p>
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <Markdown>{md}</Markdown>
        </div>
        <div className="mt-4 flex gap-3 text-xs">
          <Link to="/terms" className="text-zinc-500 hover:text-zinc-300">
            {COPY[lang].termsTitle} →
          </Link>
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}
