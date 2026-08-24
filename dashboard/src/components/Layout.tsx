import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useIsMobile } from '../hooks/use-mobile'
import { LogOut, Key, BarChart3, LayoutDashboard, ArrowUpRight, Activity, Plus, Trash2, MessageCircle, Calendar, Tv, Mail, IdCard, Cookie, Users, CreditCard } from 'lucide-react'
import { HiOutlineHome, HiOutlineKey, HiOutlineChartBar, HiOutlineBookOpen, HiOutlineChat } from 'react-icons/hi'
import { ChatHistoryProvider, useChatHistory } from '../lib/chat-history'
import Avatar from './Avatar'
import UpgradeDialog from './UpgradeDialog'
import MembersManagerDialog from './MembersManagerDialog'
import PaymentsHistoryDialog from './PaymentsHistoryDialog'
import { openCookiePreferences } from './CookieConsent'
import { Marker, MarkerContent } from './ui/marker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarSeparator,
  SidebarRail,
  SidebarTrigger,
  SidebarInset,
} from '../components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu'


const links = [
  { to: '/', label: 'Dashboard', icon: HiOutlineHome },
  { to: '/chat', label: 'Chat', icon: HiOutlineChat },
  // { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/keys', label: 'API Keys', icon: HiOutlineKey },
  { to: '/usage', label: 'Usage', icon: HiOutlineChartBar },
  { to: '/docs', label: 'Docs', icon: HiOutlineBookOpen },
]

const TIER_NAMES: Record<string, string> = {
  free: 'Free',
  nomad: 'Nomad',
  dreamer: 'Dreamer',
  entrepreneur: 'Entrepreneur',
  angel: 'Angel',
}

function tierLabel(user: {
  is_owner: boolean
  is_member: boolean
  is_paid: boolean
  tier_id?: string | null
}): { label: string; className: string } {
  if (user.is_owner) {
    return { label: 'Owner', className: 'bg-yellow-900/50 text-yellow-400' }
  }
  if (user.is_member) {
    const tier = TIER_NAMES[user.tier_id ?? ''] 
    return tier
      ? { label: `Member · ${tier}`, className: 'bg-emerald-900/50 text-emerald-400' }
      : { label: 'Member', className: 'bg-emerald-900/50 text-emerald-400' }
  }
  if (user.is_paid) {
    const tier = TIER_NAMES[user.tier_id ?? '']
    return tier
      ? { label: tier, className: 'bg-sky-900/50 text-sky-400' }
      : { label: 'Paid', className: 'bg-sky-900/50 text-sky-400' }
  }
  return { label: 'Free', className: 'bg-zinc-800 text-zinc-500' }
}

function SidebarInner() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const { conversations, activeId, setActiveId, remove, refresh } = useChatHistory()

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const selectConv = (convId: string) => {
    setActiveId(convId)
    navigate('/chat')
  }

  const deleteConv = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation()
    remove(convId)
    if (activeId === convId) {
      setActiveId(null)
    }
  }

  return [
    <SidebarHeader key="header" className="px-3 py-3 flex-row flex items-center gap-2">
      <SidebarTrigger className="text-zinc-400 hover:text-zinc-200 shrink-0 size-8" />
      <h1 className="text-lg font-bold tracking-tight flex-1 group-data-[collapsible=icon]:hidden">
        Detroit LLM
      </h1>
    </SidebarHeader>,
    <SidebarSeparator key="sep" />,
    <SidebarContent key="content">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className=" text-white cursor-pointer"
                onClick={() => {
                  setActiveId(null)
                  navigate('/chat')
                }}
              >
                <Plus size={18} />
                <span>New Chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {links.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={loc.pathname === to}>
                  <NavLink to={to} end={to === '/'}>
                    <Icon size={18} />
                    <span>{label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <div className="group-data-[collapsible=icon]:hidden px-3">
        <Marker variant="separator">
          <MarkerContent className="text-[11px] text-zinc-500 font-medium">History</MarkerContent>
        </Marker>
      </div>
      <div className="flex-1 overflow-y-auto px-2 group-data-[collapsible=icon]:hidden">
        {conversations.length === 0 ? (
          <p className="text-xs text-zinc-600 px-2 pt-2">No conversations yet</p>
        ) : (
          <SidebarMenu>
            {conversations.map((conv) => (
              <SidebarMenuItem key={conv.id}>
                <SidebarMenuButton
                  isActive={activeId === conv.id}
                  onClick={() => selectConv(conv.id)}
                  className="relative pr-8"
                >
                  <MessageCircle size={16} />
                  <span className="truncate text-xs">{conv.title}</span>
                  <button
                    onClick={(e) => deleteConv(e, conv.id)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/menu-item:opacity-100 hover:bg-zinc-700/50 transition-opacity"
                  >
                    <Trash2 size={12} className="text-zinc-500 hover:text-red-400" />
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </div>
    </SidebarContent>,
    <SidebarFooter key="footer" className="p-3">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-3 w-full text-left group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <div
              className="relative h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-medium text-zinc-300 shrink-0 overflow-visible cursor-pointer transition-opacity hover:opacity-80"
              title="View profile"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                setProfileOpen(true)
              }}
            >
              <Avatar url={user?.avatar_url} name={user?.display_name} email={user?.email} className="h-full w-full rounded-full" />
              {user && (
                <span
                  className={`hidden group-data-[collapsible=icon]:flex absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap 
                    rounded-full px-1 py-px text-[7px] font-semibold leading-none ${tierLabel(user).className}`}
                >
                  {tierLabel(user).label.split('·').pop()?.trim()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              {user?.display_name && (
                <div className="text-xs font-medium truncate flex items-center gap-1.5">
                  {user.display_name}
                  {(() => {
                    const t = tierLabel(user)
                    return (
                      <span className={`rounded-full ${t.className} text-[9px] px-1.5 py-0.5 font-medium`}>
                        {t.label}
                      </span>
                    )
                  })()}
                </div>
              )}
              <div className="text-[11px] max-w-50 min-w-50 text-zinc-500 truncate">
                {user?.email}
              </div>
            </div>
            <LogOut
              size={14}
              className="shrink-0 text-zinc-500 group-data-[collapsible=icon]:hidden"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="right"
            sideOffset={8}
            className="w-48"
          >
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setUpgradeOpen(true)
              }}
            >
              <ArrowUpRight size={16} />
              Upgrade
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                navigate('/usage')
              }}
            >
              <Activity size={16} />
              Status (Usage)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                openCookiePreferences()
              }}
            >
              <Cookie size={16} />
              Cookie settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setPaymentsOpen(true)
              }}
            >
              <CreditCard size={16} />
              Payments
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setProfileOpen(true)
              }}
            >
              <IdCard size={16} />
              Profile Information
            </DropdownMenuItem>
            {user?.is_owner && (
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  setMembersOpen(true)
                }}
              >
                <Users size={16} />
                Members
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                handleLogout()
              }}
              className="text-red-400 focus:text-red-400 focus:bg-red-950/50"
            >
              <LogOut size={16} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>,
      <SidebarRail key="rail" />,
      <ProfileDialog
        key="profile-dialog"
        open={profileOpen}
        onOpenChange={setProfileOpen}
        user={user}
        onUpgrade={() => {
          setProfileOpen(false)
          setUpgradeOpen(true)
        }}
      />,
      <UpgradeDialog key="upgrade-dialog" open={upgradeOpen} onOpenChange={setUpgradeOpen} />,
      <MembersManagerDialog key="members-dialog" open={membersOpen} onOpenChange={setMembersOpen} />,
      <PaymentsHistoryDialog key="payments-dialog" open={paymentsOpen} onOpenChange={setPaymentsOpen} />
  ]
}

function ProfileDialog({
  open,
  onOpenChange,
  user,
  onUpgrade,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: string; email: string; display_name: string; avatar_url?: string; youtube_channel_id?: string | null; is_owner: boolean; is_member: boolean; is_verified?: boolean; is_paid?: boolean; tier_id?: string | null; phone_number?: string | null; created_at?: string } | null
  onUpgrade?: () => void
}) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const plan = user.is_owner
    ? { label: 'Owner', className: 'bg-indigo-900/50 text-indigo-300' }
    : user.is_member
      ? {
          label: TIER_NAMES[user.tier_id ?? ''] ? `Member · ${TIER_NAMES[user.tier_id ?? '']}` : 'Member',
          className: 'bg-emerald-900/50 text-emerald-400',
        }
      : user.is_paid
        ? {
            label: TIER_NAMES[user.tier_id ?? ''] ?? 'Paid',
            className: 'bg-sky-900/50 text-sky-400',
          }
        : { label: 'Free', className: 'bg-zinc-800 text-zinc-500' }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>Your Google account details</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 pt-2 pb-4">
          <div className="relative">
            <Avatar url={user.avatar_url} name={user.display_name} email={user.email} className="size-20 rounded-full border-2 border-zinc-700" />
            <span
              className={`absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-medium ${plan.className}`}
            >
              {plan.label}
            </span>
          </div>

          <div className="text-center">
            <div className="text-lg font-semibold text-zinc-100 flex items-center justify-center gap-1.5">
              {user.display_name || 'No display name'}
            </div>
            <div className="text-sm text-zinc-500">{user.email}</div>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
          <div className="flex items-center gap-2 text-zinc-400">
            <Mail size={14} className="shrink-0" />
            <span className="text-zinc-500">Email</span>
            <span className="ml-auto truncate text-zinc-200">{user.email}</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <Tv size={14} className="shrink-0" />
            <span className="text-zinc-500">Channel ID</span>
            <span className="ml-auto truncate font-mono text-zinc-200">
              {user.youtube_channel_id || 'Not linked'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <IdCard size={14} className="shrink-0" />
            <span className="text-zinc-500">User ID</span>
            <span className="ml-auto truncate font-mono text-zinc-200">
              {user.id}
            </span>
          </div>
          {user.created_at && (
            <div className="flex items-center gap-2 text-zinc-400">
              <Calendar size={14} className="shrink-0" />
              <span className="text-zinc-500">Joined</span>
              <span className="ml-auto text-zinc-200">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {!user.is_owner && !user.is_member && !user.is_paid && onUpgrade && (
          <button
            onClick={onUpgrade}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-8 py-3 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90"
          >
            <ArrowUpRight size={16} />
            Upgrade plan
          </button>
        )}

        <DialogFooter className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              onOpenChange(false)
              logout()
              navigate('/login')
            }}
            className="inline-flex items-center justify-center gap-3 rounded-lg bg-red-950/50 px-8 py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50 hover:text-red-300"
          >
            <LogOut size={16} />
            Log out
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="btn-primary"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BottomNav() {
  const { user } = useAuth()
  const loc = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const item = (to: string, label: string, icon: React.ReactNode, end = false) => {
    const active = end ? loc.pathname === to : loc.pathname === to
    return (
      <NavLink
        to={to}
        end={end}
        className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
          active ? 'text-(--primary-color)' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        {icon}
        <span>{label}</span>
      </NavLink>
    )
  }

  return [
    <nav
      key="bottomnav"
      className="fixed bottom-0 inset-x-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4 h-16">
        {item('/', 'Dashboard', <LayoutDashboard size={20} />, true)}
        {item('/keys', 'API Keys', <Key size={20} />)}
        {item('/usage', 'Usage', <BarChart3 size={20} />)}
        <button
          onClick={() => setProfileOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
        >
          <div className="h-6 w-6 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
            <Avatar url={user?.avatar_url} name={user?.display_name} email={user?.email} className="h-full w-full" />
          </div>
          <span>Profile</span>
        </button>
      </div>
    </nav>,
    <ProfileDialog
      key="bottom-profile"
      open={profileOpen}
      onOpenChange={setProfileOpen}
      user={user}
      onUpgrade={() => {
        setProfileOpen(false)
        setUpgradeOpen(true)
      }}
    />,
    <UpgradeDialog key="bottom-upgrade" open={upgradeOpen} onOpenChange={setUpgradeOpen} />,
  ]
}

export default function Layout() {
  const isMobile = useIsMobile()

  return (
    <ChatHistoryProvider>
      <SidebarProvider defaultOpen={false}>
        {!isMobile && (
          <Sidebar
            collapsible="icon"
            variant="inset"
            className="bg-[oklch(0.21_0.006_285.885)] text-[oklch(0.985_0_0)]"
          >
            <SidebarInner />
          </Sidebar>
        )}
        <SidebarInset className="bg-zinc-950 h-dvh flex flex-col flex-1 overflow-hidden">
          <main className="p-8 flex-1 flex flex-col min-w-0 overflow-y-auto md:pb-8 pb-24">
            <Outlet />
          </main>
        </SidebarInset>
        {isMobile && <BottomNav />}
      </SidebarProvider>
    </ChatHistoryProvider>
  )
}