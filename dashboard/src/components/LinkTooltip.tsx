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
  if (!path) return hostname(u)
  const last = path.split('/').filter(Boolean).pop() || ''
  const decoded = decodeURIComponent(last).replace(/\.html?$/, '')
  return decoded.replace(/[-_]+/g, ' ').trim() || hostname(u)
}

function Favicon({ domain }: { domain: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      className="size-4 shrink-0 rounded-sm"
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

export function LinkTooltip({ href, children }: { href: string; children: React.ReactNode }) {
  const url = safeUrl(href)
  const domain = url ? hostname(url) : href
  const title = url ? titleFromUrl(url) : href

  const content = (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Favicon domain={domain} />
        <span className="truncate">{domain}</span>
      </div>
      <div className="text-sm font-medium leading-snug text-neutral-100">{title}</div>
      <div className="break-words text-xs leading-relaxed text-neutral-400">{href}</div>
    </div>
  )

  return (
    <Tooltip content={content}>
      <a className="text-white underline underline-offset-2 transition-colors hover:text-zinc-200" href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    </Tooltip>
  )
}