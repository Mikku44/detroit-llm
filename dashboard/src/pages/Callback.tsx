import { useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../lib/auth'

export default function Callback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setApiKey } = useAuth()
  const location = useLocation()

  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      toast.error(decodeURIComponent(oauthError))
      navigate('/login', { replace: true })
      return
    }

    // Token arrives in the URL fragment (#token=...) — not the query string —
    // so it never leaks via Referer/logs. Read it from the hash, then scrub it.
    const hash = location.hash || ''
    let key = ''
    const m = hash.match(/[#&]token=([^&]+)/)
    if (m) key = decodeURIComponent(m[1])

    if (key) {
      setApiKey(key)
        .then(() => {
          // Remove the token from the URL (replace the fragment) so it does not
          // linger in browser history.
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          navigate('/welcome', { replace: true })
        })
        .catch(() => toast.error('Authentication failed. Please try again.'))
    } else {
      toast.error('No session token received. Authentication may have failed.')
    }
  }, [searchParams, setApiKey, navigate, location.hash])

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">
      Authenticating...
    </div>
  )
}
