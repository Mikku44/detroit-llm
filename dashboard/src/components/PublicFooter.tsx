import { Link } from 'react-router-dom'

export default function PublicFooter() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Detroit LLM" className="h-6 w-6 rounded" />
              <span className="text-sm font-bold text-zinc-100">Detroit LLM</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">Everything you need — chat, API, key management and usage in one place.</p>
            <p className="mt-2 text-xs text-zinc-600">LLM Gateway • AI Gateway</p>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Product</div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500">
              <a href="/#features" className="hover:text-zinc-300">Features</a>
              <a href="/#models" className="hover:text-zinc-300">Models</a>
              <Link to="/docs" className="hover:text-zinc-300">Docs</Link>
              <Link to="/whatsnew" className="hover:text-zinc-300">What&apos;s New</Link>
              <Link to="/login" className="hover:text-zinc-300">Sign in</Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Resources</div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500">
              <Link to="/docs" className="hover:text-zinc-300">API Reference</Link>
              <a href="https://discord.gg/KuMVmcK3cC" target="_blank" rel="noreferrer" className="hover:text-zinc-300">Discord</a>
              <a href="https://www.facebook.com/khainapp" target="_blank" rel="noreferrer" className="hover:text-zinc-300">Facebook</a>
              <Link to="/models" className="hover:text-zinc-300">Models</Link>
              <Link to="/whatsnew" className="hover:text-zinc-300">What&apos;s New</Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Legal</div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500">
              <Link to="/privacy" className="hover:text-zinc-300">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-zinc-300">Terms of Use</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-zinc-800 pt-6 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-zinc-600">© {new Date().getFullYear()} Detroit LLM — MIKKUCN • chat.khain.app</div>
          <div className="text-xs text-zinc-600">Everything you need to integrate Detroit LLM into your applications.</div>
        </div>
      </div>
    </footer>
  )
}
