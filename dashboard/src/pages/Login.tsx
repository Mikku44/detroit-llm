import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import PixelBlast from '../components/PixelBlast'
import SplitText from '../components/SplitText'
import ClickSpark from '../components/ClickSpark'
import { FaDiscord, FaFacebook } from 'react-icons/fa6'
import { openCookiePreferences } from '../components/CookieConsent'
import LoginConsentModal, { hasLegalConsent } from '../components/LoginConsentModal'

export default function Login() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [consentOpen, setConsentOpen] = useState(false)

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [user, loading, navigate])

  if (loading) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">Loading...</div>
  if (user) return null

  const handleSignIn = (e: React.MouseEvent) => {
    e.preventDefault()
    if (hasLegalConsent()) {
      window.location.href = api.userLoginUrl()
    } else {
      setConsentOpen(true)
    }
  }

  return (
    <ClickSpark sparkColor="#a78bfa" sparkSize={8} sparkRadius={20} sparkCount={10} duration={500}>
      <div className="relative flex md:flex-row-reverse flex-col h-screen items-center justify-center bg-zinc-950">
        <div className="relative md:w-1/2 z-10 flex flex-col items-center text-center gap-8 px-4 max-w-md">

          {/* Header Section */}
          <div className="pointer-events-none select-none">
            <div className="mb-1">
              <SplitText
                text="Detroit LLM"
                className="text-3xl md:text-5xl font-bold text-zinc-100"
                delay={30}
                duration={1.0}
                ease="power3.out"
                splitType="chars"
                from={{ opacity: 0, y: 40 }}
                to={{ opacity: 1, y: 0 }}
                tag="h1"
              />
            </div>
          <div className="text-3xl md:text-5xl font-bold text-white">Gateway</div>
            <p className="text-zinc-500 mt-4">
              Sign in with your Google account to access the LLM
            </p>
          </div>

          {/* Action Section */}
          <div className="flex flex-col items-center gap-4 w-full">
            <a
              href={api.userLoginUrl()}
              onClick={handleSignIn}
              className="inline-flex items-center justify-center gap-3 rounded-lg bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/50 px-8 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </a>

            <p className="text-xs text-zinc-600">
              Only YouTube members of the linked channel get access.
            </p>
          </div>

          {/* Help & Support Section */}
          <div className="flex flex-col items-center gap-4 w-full pt-4 border-t border-zinc-800/60">
            <p className="text-xs font-medium text-zinc-500">Help & Support</p>
            <div className="flex items-center gap-5">
              <a
                href="https://discord.gg/KuMVmcK3cC"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-900/60 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                title="Join our Discord"
              >
                <FaDiscord size={18} />
              </a>
              <a
                href="https://www.facebook.com/khainapp"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-full border border-zinc-700/60 bg-zinc-900/60 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                title="Follow us on Facebook"
              >
                <FaFacebook size={18} />
              </a>
            </div>
            <button
              onClick={openCookiePreferences}
              className="text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
            >
              Cookie settings
            </button>
          </div>

        </div>

        <div className="absolute max-h-screen md:w-4/5 overflow-hidden rounded-2xl">
          <PixelBlast
            variant="square"
            pixelSize={6}
            color="#362F4F"
            className="absolute inset-0 z-0"
            enableRipples={true}
            speed={0.8}
            edgeFade={0.3}
            patternScale={2}
            patternDensity={1}
            pixelSizeJitter={0}
            rippleSpeed={0.9}
            rippleThickness={0.12}
            rippleIntensityScale={1.5}
            liquid={false}
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
          />
        </div>
      </div>
      <LoginConsentModal open={consentOpen} onOpenChange={setConsentOpen} />
    </ClickSpark>
  )
}