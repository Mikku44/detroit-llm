import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function PublicNavbar() {
  const { user } = useAuth()
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
        <div className="flex gap-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Detroit LLM" className="h-7 w-7 rounded" />
            <span className="text-sm font-bold tracking-tight md:text-base">Detroit LLM</span>
            <span className="hidden rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 md:inline">Gateway</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            <a href="/#features" className="hover:text-zinc-100">Features</a>
            <a href="/#faq" className="hover:text-zinc-100">FAQ</a>
            <Link to="/docs" className="hover:text-zinc-100">Docs</Link>
            <Link to="/models" className="hover:text-zinc-100">Models</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {user ? <Link to="/" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">Go to Dashboard</Link> : <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white">Sign in</Link>}
        </div>
      </div>
    </header>
  )
}
