import { useEffect, useRef, useState } from 'react'
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential } from 'firebase/auth'
import { app } from '../lib/firebase'
import { api } from '../lib/api'
import { Phone, KeyRound, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export default function PhoneVerifyDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerified: (phoneNumber: string) => void
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [confirmation, setConfirmation] = useState<any>(null)
  const recaptchaRef = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<any>(null)

  useEffect(() => {
    if (!open) {
      setPhone('')
      setCode('')
      setSent(false)
      setError(null)
      setSuccess(false)
      setConfirmation(null)
    }
  }, [open])

  useEffect(() => {
    if (open && recaptchaRef.current) {
      const auth = getAuth(app)
      if (verifierRef.current) {
        try {
          verifierRef.current.clear()
        } catch {}
      }
      verifierRef.current = new RecaptchaVerifier(auth, recaptchaRef.current, {
        size: 'invisible',
      })
    }
  }, [open])

  const sendCode = async () => {
    const trimmed = phone.trim()
    if (!trimmed) {
      setError('Please enter your phone number.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const auth = getAuth(app)
      if (!verifierRef.current) {
        verifierRef.current = new RecaptchaVerifier(auth, recaptchaRef.current!, {
          size: 'invisible',
        })
      }
      const confirmationResult = await signInWithPhoneNumber(auth, trimmed, verifierRef.current)
      setConfirmation(confirmationResult)
      setSent(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to send verification code.')
    } finally {
      setBusy(false)
    }
  }

  const confirmCode = async () => {
    if (!confirmation || !code.trim()) {
      setError('Enter the verification code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const credential = PhoneAuthProvider.credential(confirmation.verificationId, code.trim())
      const result = await signInWithCredential(getAuth(app), credential)
      const phoneNumber = result.user?.phoneNumber || phone.trim()
      await api.verifyPhone(phoneNumber)
      setSuccess(true)
      onVerified(phoneNumber)
    } catch (e: any) {
      setError(e?.message || 'Invalid verification code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Verify your phone number</DialogTitle>
          <DialogDescription>
            Confirm your phone to verify your account. A code will be sent via SMS.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div ref={recaptchaRef} />

          {error && (
            <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          {success ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-4 text-center">
              <Check size={24} className="text-emerald-400" />
              <p className="text-sm font-medium text-emerald-300">Phone verified!</p>
            </div>
          ) : !sent ? (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2">
                <Phone size={15} className="shrink-0 text-zinc-500" />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+66 81 234 5678"
                  inputMode="tel"
                  className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                />
              </div>
              <button
                onClick={sendCode}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-4 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send verification code'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2">
                <KeyRound size={15} className="shrink-0 text-zinc-500" />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                />
              </div>
              <button
                onClick={confirmCode}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-4 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
              <button
                onClick={() => setSent(false)}
                className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
              >
                Change phone number
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
