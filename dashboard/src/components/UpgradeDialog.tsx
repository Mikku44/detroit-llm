import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { CreditCard, TvMinimalPlay, Check } from 'lucide-react'
import { HiCubeTransparent } from 'react-icons/hi'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { FaDiscord } from 'react-icons/fa6'

interface Tier {
  id: string
  name: string
  price: string
  net: string
  weekly: number
  monthly: number
  image_quota?: number
  deepseek_cost: string
  profit: string
  margin: string
}

export default function UpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const [tiers, setTiers] = useState<Tier[]>([])
  const [membersUrl, setMembersUrl] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [sub, setSub] = useState<{ active: boolean; is_paid: boolean; status?: string | null; canceled?: boolean } | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelMsg, setCancelMsg] = useState<string | null>(null)
  const [subError, setSubError] = useState<string | null>(null)
  const [ytChecking, setYtChecking] = useState(false)
  const [ytFallbackOpen, setYtFallbackOpen] = useState(false)

  // The user's current plan tier (from Stripe subscription or YouTube membership).
  const currentTierId = user?.tier_id ?? null

  useEffect(() => {
    if (!open) return
    setCheckoutError(null)
    setCancelMsg(null)
    setSubError(null)
    api
      .getUsageLimits()
      .then((l) => setTiers((l.tiers || []).filter((t: Tier) => t.id !== 'free')))
      .catch(() => setTiers([]))
    api
      .health()
      .then((h) => setMembersUrl(h.members_url || ''))
      .catch(() => setMembersUrl(''))
    api
      .getSubscription()
      .then(setSub)
      .catch(() => setSub(null))
  }, [open])

  const startCheckout = async (tierId: string, paymentMethod: string = 'card') => {
    setCheckoutBusy(`${tierId}:${paymentMethod}`)
    setCheckoutError(null)
    try {
      const res = await api.createCheckout(tierId, paymentMethod)
      if (res?.url) {
        window.location.href = res.url
      } else {
        setCheckoutError('Stripe did not return a checkout URL. Try again.')
      }
    } catch (e: any) {
      setCheckoutError(e?.message || 'Failed to start checkout')
    } finally {
      setCheckoutBusy(null)
    }
  }

  const cancelSub = async () => {
    setCancelBusy(true)
    setCancelMsg(null)
    setSubError(null)
    try {
      const res = await api.cancelSubscription()
      setCancelMsg(
        res?.at_period_end
          ? `Canceled — access stays active until the end of the billing period.`
          : `Subscription canceled.`,
      )
      setSub((s) => (s ? { ...s, active: false, status: 'canceled', canceled: true } : s))
    } catch (e: any) {
      setSubError(e?.message || 'Failed to cancel subscription')
    } finally {
      setCancelBusy(false)
    }
  }

  const joinYouTubeMember = async () => {
    if (!membersUrl) return
    setYtChecking(true)
    try {
      const status = await api.youtubeMembersStatus()
      // If the members API is live, joining is picked up automatically.
      if (status?.available) {
        window.open(membersUrl, '_blank', 'noopener,noreferrer')
        return
      }
      // Otherwise fall back: warn the user to ping us on Discord or use Stripe.
      setYtFallbackOpen(true)
    } catch {
      setYtFallbackOpen(true)
    } finally {
      setYtChecking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade your plan</DialogTitle>
          <DialogDescription>
            Subscribe monthly — access is granted automatically after payment
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {checkoutError && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {checkoutError}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tiers.map((t) => {
              const isCurrent = currentTierId === t.id
              return (
                <div
                  key={t.id}
                  className={`relative flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                    isCurrent
                      ? 'border-(--primary-color)/60 bg-(--primary-color)/10 ring-1 ring-(--primary-color)/40'
                      : 'border-zinc-800 bg-zinc-950/60'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-(--primary-color) px-2.5 py-0.5 text-[10px] font-semibold text-(--primary-foreground)">
                      Current plan
                    </span>
                  )}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <HiCubeTransparent size={20} className="text-(--primary-color) shrink-0" />
                      <span className="font-semibold text-sm text-zinc-100">{t.name}</span>
                      {isCurrent && <Check size={14} className="text-(--primary-color)" />}
                    </div>
                    <div className="text-xl font-bold text-zinc-100 tabular-nums">
                      {t.price}
                      <span className="ml-1 text-xs font-normal text-zinc-500">/ month</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[11px] text-zinc-400">
                      <p>{t.weekly.toLocaleString()} tokens / week</p>
                      <p>{t.monthly.toLocaleString()} tokens / month</p>
                      {t.image_quota != null && <p>{t.image_quota.toLocaleString()} images / month</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {isCurrent ? (
                      <>
                        {cancelMsg && (
                          <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-400">
                            {cancelMsg}
                          </p>
                        )}
                        {subError && (
                          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                            {subError}
                          </p>
                        )}
                        {user?.is_paid ? (
                          <button
                            onClick={cancelSub}
                            disabled={cancelBusy || sub?.canceled}
                            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                              sub?.canceled
                                ? 'border border-zinc-800 bg-zinc-900 text-zinc-500'
                                : 'border border-red-900 bg-red-950 text-white hover:bg-red-900'
                            }`}
                          >
                            {cancelBusy
                              ? 'Canceling…'
                              : sub?.canceled
                                ? 'Cancels at end of period'
                                : 'Cancel subscription'}
                          </button>
                        ) : (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-xs text-zinc-400">
                            
                            Cancel Your Membership on YouTube.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => startCheckout(t.id, 'card')}
                          disabled={checkoutBusy === `${t.id}:card`}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-3 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <CreditCard size={15} />
                          {checkoutBusy === `${t.id}:card` ? 'Opening…' : `Card ${t.price}/mo`}
                        </button>
                        <button
                          onClick={() => startCheckout(t.id, 'promptpay')}
                          disabled={checkoutBusy === `${t.id}:promptpay`}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                        >
                          <img src="/PromptPay-logo.png" alt="PromptPay" className="h-5 w-auto object-contain" />
                          {checkoutBusy === `${t.id}:promptpay` ? 'Opening…' : `PromptPay ${t.price}`}
                        </button>
                        <p className="text-[10px] text-zinc-500 text-center">PromptPay = one-time QR, 30 days</p>
                      </div>
                    )}
                    {membersUrl ? (
                      <button
                        onClick={joinYouTubeMember}
                        disabled={ytChecking}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                      >

                        {ytChecking ? 'Checking…' : 'Join YouTube member'}
                      </button>
                    ) : (
                      <button
                        disabled
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-600 opacity-60"
                      >
                        <TvMinimalPlay size={15} />
                        Membership page unavailable
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {tiers.length === 0 && (
              <p className="text-sm text-zinc-600 col-span-full">Loading plans…</p>
            )}
          </div>
        </div>
      </DialogContent>

      <Dialog open={ytFallbackOpen} onOpenChange={setYtFallbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Automated verification unavailable</DialogTitle>
            <DialogDescription>
              Our automated YouTube membership check is not fully set up yet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1 text-sm text-zinc-400 leading-relaxed">
            <p>
              If you&apos;ve already completed your YouTube membership, please let us know on
              Discord and we&apos;ll activate your access manually.
            </p>
            <a
              href="https://discord.gg/KuMVmcK3cC"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 w-full rounded-lg bg-indigo-500 
              px-4 py-2 text-sm font-medium text-white justify-center transition-colors hover:bg-[#7289da]"
            >
              <FaDiscord size={15} />
              Join our Discord
            </a>
            <div className="flex items-center gap-3 text-[11px] text-zinc-600">
              <span className="h-px flex-1 bg-zinc-800" />
              or
              <span className="h-px flex-1 bg-zinc-800" />
            </div>
            <p>
              For instant access, use Stripe instead — it activates your plan automatically.
            </p>
            <button
              onClick={() => setYtFallbackOpen(false)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-4 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90"
            >
              <CreditCard size={15} />
              Use Stripe instead
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
