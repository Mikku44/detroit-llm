import { Tooltip } from './ui/tooltip-card'

function safeUrl(href: string): URL | null {
  try {
    const u = new URL(href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u
  } catch {
    return null
  }
}

function hostname(u: URL): string {
  return u.hostname.replace(/^www\./, '')
}

function titleFromUrl(u: URL): string {
  const path = u.pathname.replace(/\/+$/, '')
  if (!path || path === '/') return hostname(u)
  const last = path.split('/').filter(Boolean).pop() || ''
  const decoded = decodeURIComponent(last).replace(/\.html?$/, '')
  const pretty = decoded.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!pretty) return hostname(u)
  return pretty.length > 60 ? `${pretty.slice(0, 60)}…` : pretty
}

function labelFromChildren(children: React.ReactNode): string | null {
  if (typeof children === 'string') return children.trim() || null
  if (Array.isArray(children)) {
    const text = children.filter((c): c is string => typeof c === 'string').join('').trim()
    return text || null
  }
  return null
}

function Favicon({ domain }: { domain: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="size-4 shrink-0 rounded-full bg-white object-cover"
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

export function LinkTooltip({ href, children }: { href: string; children: React.ReactNode }) {
  const url = safeUrl(href)
  if (!url) {
    return (
      <a
        className="text-white underline underline-offset-2 transition-colors hover:text-zinc-200"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    )
  }
  const domain = hostname(url)
  const pageTitle = titleFromUrl(url)
  const childText = labelFromChildren(children)
  const isBareUrl = !childText || childText === href || childText.replace(/\/+$/, '') === href.replace(/\/+$/, '')
  // Badge label: custom link text wins, otherwise derived page title.
  // Domain is always visible (muted) so the badge carries logo + web title.
  const label = isBareUrl ? pageTitle : childText!

  const content = (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Favicon domain={domain} />
        <span className="truncate">{domain}</span>
      </div>
      <div className="text-sm font-medium leading-snug text-neutral-100">{isBareUrl ? pageTitle : childText}</div>
      <div className="break-words text-xs leading-relaxed text-neutral-400">{href}</div>
    </div>
  )

  return (
    <Tooltip content={content}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={`${label} — ${domain}`}
        className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/70 py-[3px] pr-2.5 pl-1.5 align-baseline text-xs font-medium whitespace-nowrap text-zinc-200 no-underline transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
      >
        <Favicon domain={domain} />
        <span className="max-w-44 truncate leading-4">{label}</span>
        <span className="max-w-28 shrink-0 truncate leading-4 font-normal text-zinc-400">· {domain}</span>
      </a>
    </Tooltip>
  )
}