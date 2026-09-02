import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useIsMobile } from '../hooks/use-mobile'
import { LogOut, Key, BarChart3, LayoutDashboard, ArrowUpRight, Activity, Plus, Trash2, MessageCircle, Calendar, Tv, Mail, IdCard, Cookie, Users, CreditCard, MoreHorizontal, X } from 'lucide-react'
import { HiOutlineHome, HiOutlineKey, HiOutlineChartBar, HiOutlineBookOpen, HiOutlineChat, HiOutlineShieldCheck, HiOutlineTerminal, HiOutlineCube } from 'react-icons/hi'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import IOSLoading from './ios-loading'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import { motion, AnimatePresence } from 'motion/react'


const links = [
  { to: '/', label: 'Dashboard', icon: HiOutlineHome },
  { to: '/chat', label: 'Chat', icon: HiOutlineChat },
  { to: '/keys', label: 'API Keys', icon: HiOutlineKey },
  { to: '/usage', label: 'Usage', icon: HiOutlineChartBar },
  { to: '/docs', label: 'Docs', icon: HiOutlineBookOpen },
  { to: '/models', label: 'Models', icon: HiOutlineCube },
]

const adminLinks = [
  { to: '/admin', label: 'System', icon: HiOutlineShieldCheck },
  { to: '/console', label: 'Console', icon: HiOutlineTerminal },
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const selectConv = (convId: string) => {
    setActiveId(convId)
    navigate(`/chat/${convId}`)
  }

  const deleteConv = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation()
    const conv = conversations.find((c) => c.id === convId)
    setDeleteTarget({ id: convId, title: conv?.title || 'this conversation' })
    setDeleteError(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    const wasActive = activeId === deleteTarget.id
    const targetId = deleteTarget.id
    setDeleting(true)
    setDeleteError(null)
    try {
      await remove(targetId)
      setDeleteTarget(null)
      if (wasActive) navigate('/chat')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete. Please try again.')
    } finally {
      setDeleting(false)
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
                <SidebarMenuButton asChild isActive={to === '/chat' ? loc.pathname === '/chat' || loc.pathname.startsWith('/chat/') : loc.pathname === to}>
                  <NavLink to={to} end={to === '/'}>
                    <Icon size={18} />
                    <span>{label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {user?.is_owner && adminLinks.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={loc.pathname === to}>
                  <NavLink to={to}>
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
      <PaymentsHistoryDialog key="payments-dialog" open={paymentsOpen} onOpenChange={setPaymentsOpen} />,
      <AlertDialog key="delete-dialog" open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="sm:max-w-md bg-zinc-800/50 border-zinc-700 backdrop-blur-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete <span className="font-medium text-zinc-200">"{deleteTarget?.title}"</span> and all its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600 disabled:opacity-50"
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Deleting...
                </span>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
      deleting && (
        <div key="delete-loading" className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <IOSLoading size={48} />
          <p className="text-sm font-medium text-zinc-200">Deleting conversation...</p>
          <p className="text-xs text-zinc-500">Please wait</p>
        </div>
      ),
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
  const navigate = useNavigate()
  const { setActiveId } = useChatHistory()
  const [profileOpen, setProfileOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const allLinks = [
    ...links,
    ...(user?.is_owner ? adminLinks : []),
  ]

  const isActive = (to: string) => {
    if (to === '/chat') return loc.pathname === '/chat' || loc.pathname.startsWith('/chat/')
    if (to === '/') return loc.pathname === '/'
    return loc.pathname === to || loc.pathname.startsWith(to + '/')
  }

  type NavItem = { key: string; label: string; shortLabel: string; to?: string; icon: React.ElementType; action?: () => void; isProfile?: boolean }
  const navItems: NavItem[] = [
    { key: 'new', label: 'New Chat', shortLabel: 'New', icon: Plus, action: () => { setActiveId(null); navigate('/chat') } },
    ...allLinks.map(l => ({ key: l.to, label: l.label, shortLabel: l.label === 'API Keys' ? 'Keys' : l.label === 'Dashboard' ? 'Home' : l.label, to: l.to, icon: l.icon })),
    { key: 'profile', label: 'Profile', shortLabel: 'Profile', icon: IdCard, isProfile: true, action: () => setProfileOpen(true) },
  ]

  const outerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(navItems.length)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ITEM_W = 64
    const update = () => {
      const w = el.clientWidth
      const maxFit = Math.floor(w / ITEM_W)
      if (navItems.length <= maxFit) setVisibleCount(navItems.length)
      else setVisibleCount(Math.max(3, maxFit - 1))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [navItems.length])

  const visibleItems = navItems.slice(0, visibleCount)
  const overflowItems = navItems.slice(visibleCount)
  const hasOverflow = overflowItems.length > 0
  const overflowActive = overflowItems.some(it => it.to && isActive(it.to))

  return [
    <motion.nav
      key="bottomnav"
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      className="fixed bottom-0 inset-x-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80 md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      <div ref={outerRef} className="flex items-center h-[64px] overflow-hidden px-1">
        <div className="flex items-center flex-1 gap-0.5 min-w-0">
          <AnimatePresence initial={false}>
            {visibleItems.map((it, idx) => {
              const content = (() => {
                if (it.isProfile) {
                  return (
                    <motion.button
                      key={it.key}
                      layout
                      initial={{ opacity: 0, y: 12, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.9 }}
                      transition={{ delay: idx * 0.03, type: 'spring', stiffness: 400, damping: 25 }}
                      whileTap={{ scale: 0.9 }}
                      whileHover={{ y: -1 }}
                      onClick={it.action}
                      className="flex flex-col items-center justify-center gap-0.5 min-w-[56px] flex-1 max-w-[72px] shrink px-1 py-1 text-[10px] font-medium leading-none text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <motion.div whileTap={{ scale: 0.9 }} className="h-6 w-6 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-zinc-700">
                        <Avatar url={user?.avatar_url} name={user?.display_name} email={user?.email} className="h-full w-full" />
                      </motion.div>
                      <span className="whitespace-nowrap">{it.shortLabel}</span>
                    </motion.button>
                  )
                }
                if (it.action && !it.to) {
                  return (
                    <motion.button
                      key={it.key}
                      layout
                      initial={{ opacity: 0, y: 12, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.9 }}
                      transition={{ delay: idx * 0.03, type: 'spring', stiffness: 400, damping: 25 }}
                      whileTap={{ scale: 0.88 }}
                      whileHover={{ y: -1 }}
                      onClick={it.action}
                      className="flex flex-col items-center justify-center gap-0.5 min-w-[56px] flex-1 max-w-[72px] shrink px-1 py-1 text-[10px] font-medium leading-none text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <motion.span whileTap={{ scale: 0.9, rotate: 90 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }} className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary-color)] text-white shadow-md">
                        <Plus size={14} />
                      </motion.span>
                      <span className="whitespace-nowrap">{it.shortLabel}</span>
                    </motion.button>
                  )
                }
                const Icon = it.icon
                const active = it.to ? isActive(it.to) : false
                return (
                  <motion.div
                    key={it.key}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8, scale: 0.9 }}
                    transition={{ delay: idx * 0.03, type: 'spring', stiffness: 400, damping: 25 }}
                    className="flex-1 max-w-[72px] min-w-[56px]"
                  >
                    <NavLink
                      to={it.to!}
                      end={it.to === '/'}
                      className="relative flex flex-col items-center justify-center gap-0.5 w-full px-1 py-1 text-[10px] font-medium leading-none transition-colors"
                    >
                      {({ isActive: navActive }) => {
                        const a = active || navActive
                        return (
                          <motion.div whileTap={{ scale: 0.88 }} whileHover={{ y: -1 }} className={`flex flex-col items-center gap-0.5 ${a ? 'text-[var(--primary-color)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            {a && (
                              <motion.span layoutId="bottomnav-active-pill" className="absolute -top-1 inset-x-2 h-7 rounded-full bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/15 -z-10" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                            )}
                            <motion.div animate={a ? { scale: 1.08, y: -1 } : { scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                              <Icon size={20} className={a ? 'text-[var(--primary-color)]' : ''} />
                            </motion.div>
                            <span className="whitespace-nowrap">{it.shortLabel}</span>
                            {a && <motion.span layoutId="bottomnav-dot" className="h-1 w-1 rounded-full bg-[var(--primary-color)]" initial={{ scale: 0 }} animate={{ scale: 1 }} />}
                          </motion.div>
                        )
                      }}
                    </NavLink>
                  </motion.div>
                )
              })()
              return content
            })}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {hasOverflow && (
            <motion.button
              key="more-btn"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileTap={{ scale: 0.88 }}
              whileHover={{ y: -1 }}
              onClick={() => setDrawerOpen(true)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[56px] shrink-0 px-1 py-1 text-[10px] font-medium leading-none transition-colors ${overflowActive ? 'text-[var(--primary-color)]' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {overflowActive && <motion.span layoutId="bottomnav-active-pill" className="absolute -top-1 inset-x-1 h-7 rounded-full bg-[var(--primary-color)]/10 border border-[var(--primary-color)]/15 -z-10" />}
              <motion.div animate={drawerOpen ? { rotate: 90 } : { rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                <MoreHorizontal size={20} className={overflowActive ? 'text-[var(--primary-color)]' : ''} />
              </motion.div>
              <span>More</span>
              {overflowActive && <span className="absolute -top-0.5 right-1 h-2 w-2 rounded-full bg-[var(--primary-color)] animate-pulse" />}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="bottom" className="bg-zinc-950 border-zinc-800 p-0 rounded-t-2xl max-h-[70vh] overflow-y-auto [&>button]:hidden">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <SheetHeader className="px-4 pt-4 pb-2 text-left border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-700" />
              <SheetTitle className="text-zinc-100 text-base">Menu</SheetTitle>
            </SheetHeader>
          </motion.div>
          <motion.div
            initial="hidden"
            animate={drawerOpen ? 'show' : 'hidden'}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } } }}
            className="grid grid-cols-4 gap-2 p-4"
          >
            {overflowItems.map((it) => {
              const cardVariants = { hidden: { opacity: 0, y: 16, scale: 0.96 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 400, damping: 25 } } }
              if (it.isProfile) {
                return (
                  <motion.button
                    key={it.key}
                    variants={cardVariants}
                    whileTap={{ scale: 0.94 }}
                    whileHover={{ y: -2, scale: 1.02 }}
                    onClick={() => { setDrawerOpen(false); it.action?.() }}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-zinc-700">
                      <Avatar url={user?.avatar_url} name={user?.display_name} email={user?.email} className="h-full w-full" />
                    </div>
                    <span className="text-xs font-medium text-zinc-300">{it.label}</span>
                  </motion.button>
                )
              }
              if (it.action && !it.to) {
                return (
                  <motion.button
                    key={it.key}
                    variants={cardVariants}
                    whileTap={{ scale: 0.94 }}
                    whileHover={{ y: -2, scale: 1.02 }}
                    onClick={() => { setDrawerOpen(false); it.action?.() }}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors"
                  >
                    <motion.span whileHover={{ rotate: 90 }} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-color)] text-white shadow">
                      <Plus size={16} />
                    </motion.span>
                    <span className="text-xs font-medium text-zinc-300">{it.label}</span>
                  </motion.button>
                )
              }
              const Icon = it.icon
              const active = it.to ? isActive(it.to) : false
              return (
                <motion.div key={it.key} variants={cardVariants} whileTap={{ scale: 0.94 }} whileHover={{ y: -2, scale: 1.02 }}>
                  <NavLink
                    to={it.to!}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors ${active ? 'bg-[var(--primary-color)]/15 border-[var(--primary-color)]/30 text-[var(--primary-color)] shadow-sm' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
                  >
                    <Icon size={24} />
                    <span className="text-xs font-medium text-center leading-tight">{it.label}</span>
                  </NavLink>
                </motion.div>
              )
            })}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="px-4 pb-6">
            <motion.button
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: 1.01 }}
              onClick={() => setDrawerOpen(false)}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800 active:bg-zinc-700"
            >
              <X size={16} /> Close
            </motion.button>
          </motion.div>
        </SheetContent>
      </Sheet>
    </motion.nav>,
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
          <main className="p-3 sm:p-8 flex-1 flex flex-col min-w-0 overflow-y-auto overflow-x-hidden md:pb-8 pb-24">
            <Outlet />
          </main>
        </SidebarInset>
        {isMobile && <BottomNav />}
      </SidebarProvider>
    </ChatHistoryProvider>
  )
}