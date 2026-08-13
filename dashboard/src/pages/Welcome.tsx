import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import PixelBlast from '../components/PixelBlast'
import SplitText from '../components/SplitText'
import ClickSpark from '../components/ClickSpark'
import IOSLoading from '../components/ios-loading'

function PlanBadge({ isOwner, isMember }: { isOwner: boolean; isMember: boolean }) {
  if (isOwner) {
    return (
      <span className="rounded-full bg-yellow-900/50 text-yellow-400 text-xs px-3 py-1 font-medium">
        Owner
      </span>
    )
  }
  if (isMember) {
    return (
      <span className="rounded-full bg-emerald-900/50 text-emerald-400 text-xs px-3 py-1 font-medium">
        Member
      </span>
    )
  }
  return (
    <span className="rounded-full bg-zinc-800 text-zinc-500 text-xs px-3 py-1 font-medium">
      Free
    </span>
  )
}

export default function Welcome() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [membersUrl, setMembersUrl] = useState('')

  useEffect(() => {
    api.health().then((h) => setMembersUrl(h.members_url || '')).catch(() => {})
  }, [])

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true })
  }, [user, loading, navigate])

  if (loading) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">Loading...</div>
  if (!user) return null

  const initial = (user.display_name || user.email || '?')[0].toUpperCase()
  return (
    <ClickSpark sparkColor="#a78bfa" sparkSize={8} sparkRadius={20} sparkCount={10} duration={500}>
      <div className="relative flex md:flex-row-reverse flex-col h-screen items-center justify-center bg-zinc-950">
        <div className="relative md:w-1/2 z-10 flex flex-col items-center text-center gap-8 px-4 max-w-md">

          {/* Header Section */}
          <div className="pointer-events-none select-none">
            <div className="mb-1">
              <SplitText
                text="Welcome"
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
            <div className="text-3xl md:text-5xl font-bold text-white">Detroit LLM</div>
            <p className="text-zinc-500 mt-4">
              Your account is ready. Let&apos;s get you started.
            </p>
          </div>

          {/* Profile Section */}
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/50 px-10 py-8 w-full">
              <div className="h-16 w-16 rounded-full bg-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-200 ring-2 ring-zinc-700 overflow-hidden">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="text-lg font-semibold text-zinc-100">
                  {user.display_name || 'Anonymous'}
                </div>
                <div className="text-sm text-zinc-500">
                  {user.email}
                </div>
              </div>
              <PlanBadge isOwner={user.is_owner} isMember={user.is_member} />
            </div>

            <div className="flex flex-col gap-2 flex-wrap">
            
            {user.is_owner || user.is_member ? (
              <button
                onClick={() => navigate('/', { replace: true })}
                className="btn-primary"
              >
                Get Started
              </button>
            ) : membersUrl ? (
              <a
                href={membersUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-membership"
              >
                Become a Member
              </a>
            ) : <div className="flex items-center justify-center p-4">
              <IOSLoading size={42} />
            </div>
          }

            <button
              onClick={() => navigate('/', { replace: true })}
              className="text-zinc-300 text-sm cursor-pointer text-muted hover:underline duration-200"
            >
              Later, now I want to explore the app
            </button>
            </div>
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
    </ClickSpark>
  )
}
