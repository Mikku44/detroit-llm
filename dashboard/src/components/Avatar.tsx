import { useState } from 'react'

interface AvatarProps {
  url?: string
  name?: string
  email?: string
  className?: string
}

export default function Avatar({ url, name, email, className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const initial = (name || email || '?')[0].toUpperCase()

  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center bg-zinc-800 text-sm font-medium text-zinc-300 overflow-hidden shrink-0 ${className}`}>
        {initial}
      </div>
    )
  }

  return (
    <div className={`overflow-hidden shrink-0 ${className}`}>
      <img
        src={url}
        alt={name || 'avatar'}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  )
}
