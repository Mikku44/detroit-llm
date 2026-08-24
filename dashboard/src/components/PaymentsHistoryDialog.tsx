import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { CreditCard, Receipt } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

interface Payment {
  id: string
  tier_id?: string | null
  amount: number
  currency: string
  status: string
  event_type?: string | null
  checkout_session_id?: string | null
  subscription_id?: string | null
  created_at?: string | null
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-emerald-900/50 text-emerald-400',
  pending: 'bg-amber-900/50 text-amber-400',
  failed: 'bg-red-900/50 text-red-400',
  refunded: 'bg-zinc-800 text-zinc-400',
  canceled: 'bg-zinc-800 text-zinc-400',
}

const TIER_NAMES: Record<string, string> = {
  nomad: 'Nomad',
  dreamer: 'Dreamer',
  entrepreneur: 'Entrepreneur',
  angel: 'Angel',
}

export default function PaymentsHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    api
      .getPayments()
      .then((d) => setPayments((d.payments || [])))
      .catch((e: any) => setError(e?.message || 'Failed to load payments'))
      .finally(() => setLoading(false))
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment history</DialogTitle>
          <DialogDescription>Your Stripe payments and subscriptions</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-800/60" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <Receipt size={22} className="text-zinc-600" />
              <p className="text-sm text-zinc-500">No payments yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                    <CreditCard size={16} className="text-zinc-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">
                        {p.tier_id ? TIER_NAMES[p.tier_id] ?? p.tier_id : 'Payment'}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                          STATUS_STYLES[p.status] ?? 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {p.created_at
                        ? new Date(p.created_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : ''}
                      {p.subscription_id ? ` · sub ${p.subscription_id.slice(-8)}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-zinc-100 tabular-nums">
                      {(p.amount / 100).toLocaleString()} {p.currency?.toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
