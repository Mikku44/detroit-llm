import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../lib/auth'

export default function Callback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setApiKey } = useAuth()

  useEffect(() => {
    const key = searchParams.get('token')
    if (key) {
      setApiKey(key)
        .then(() => navigate('/welcome', { replace: true }))
        .catch(() => toast.error('Authentication failed. Please try again.'))
    } else {
      toast.error('No session token received. Authentication may have failed.')
    }
  }, [searchParams, setApiKey, navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">
      Authenticating...
    </div>
  )
}
