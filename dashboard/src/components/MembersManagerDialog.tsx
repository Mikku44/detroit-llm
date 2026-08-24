import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ClipboardPaste, Trash2, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export default function MembersManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [count, setCount] = useState(0)
  const [ids, setIds] = useState<string[]>([])
  const [text, setText] = useState('')
  const [levelsText, setLevelsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => {
    api
      .getStoredMembers()
      .then((d) => {
        setCount(d.total_members || 0)
        setIds(d.channel_ids || [])
      })
      .catch(() => setCount(0))
  }

  useEffect(() => {
    if (!open) return
    setMsg(null)
    load()
  }, [open])

  const parseInput = (): any => {
    const trimmed = text.trim()
    if (!trimmed) return null
    // Try JSON first; if it's a plain list of channel IDs on separate lines, build a list.
    try {
      return JSON.parse(trimmed)
    } catch {
      const lines = trimmed
        .split(/\n|,|[\s]+/)
        .map((s) => s.trim())
        .filter((s) => s && s.startsWith('UC'))
      return lines
    }
  }

  const save = async () => {
    const payload = parseInput()
    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      setMsg({ ok: false, text: 'Paste a members.list JSON response or a list of channel IDs (UC...).' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const d = await api.setStoredMembers(payload)
      setCount(d.total_members || 0)
      setIds(d.channel_ids || [])
      setText('')
      setMsg({ ok: true, text: `Saved ${d.total_members} member(s).` })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Failed to save members' })
    } finally {
      setBusy(false)
    }
  }

  const saveLevels = async () => {
    const trimmed = levelsText.trim()
    if (!trimmed) {
      setMsg({ ok: false, text: 'Paste a membershipsLevelList JSON response or a levels map.' })
      return
    }
    let payload: any
    try {
      payload = JSON.parse(trimmed)
    } catch {
      setMsg({ ok: false, text: 'Levels input must be valid JSON.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const d = await api.setStoredLevels(payload)
      const n = Object.keys(d.levels || {}).length
      setLevelsText('')
      setMsg({ ok: true, text: `Saved ${n} level → tier mapping(s).` })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Failed to save levels' })
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await api.clearStoredMembers()
      setCount(0)
      setIds([])
      setText('')
      setMsg({ ok: true, text: 'Fallback member list cleared (reverted to live API).' })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Failed to clear members' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>YouTube members (fallback)</DialogTitle>
          <DialogDescription>
            Use this when the YouTube members API is unavailable (no Google Cloud Console access).
            Paste the members.list JSON response or a list of channel IDs to grant access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {msg && (
            <p
              className={`rounded-lg border px-3 py-2 text-xs ${
                msg.ok
                  ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
                  : 'border-red-900/50 bg-red-950/30 text-red-400'
              }`}
            >
              {msg.text}
            </p>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-sm font-medium text-zinc-200 mb-1">
              Stored members: <span className="text-(--primary-color)">{count}</span>
            </div>
            {ids.length > 0 ? (
              <div className="mt-2 max-h-28 overflow-y-auto rounded-md bg-zinc-950 p-2">
                {ids.map((id) => (
                  <div key={id} className="truncate font-mono text-[11px] text-zinc-400">
                    {id}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-500">
                No fallback members stored. Membership checks use the live API when available.
              </p>
            )}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder='Paste members.list JSON here, e.g. {"items":[{"snippet":{"memberDetails":{"channelId":"UC..."}}}]}
or one channel ID per line:
UCaaaa...
UCbbbb...'
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 text-xs font-medium text-zinc-300">
              Membership levels (optional — maps level IDs to tiers)
            </div>
            <textarea
              value={levelsText}
              onChange={(e) => setLevelsText(e.target.value)}
              rows={3}
              placeholder='Paste membershipsLevelList JSON, e.g. {"items":[{"id":"CKDtrd6pg9bzVA","snippet":{"levelDetails":{"displayName":"Nomad"}}}]}'
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            />
            <button
              onClick={saveLevels}
              disabled={busy}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              <ClipboardPaste size={13} />
              Save levels
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-(--primary-color) px-4 py-2 text-sm font-medium text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <ClipboardPaste size={15} />
              {busy ? 'Saving…' : 'Save members'}
            </button>
            <button
              onClick={clear}
              disabled={busy || count === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/40 disabled:opacity-50"
            >
              <Trash2 size={15} />
              Clear
            </button>
            <button
              onClick={load}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
