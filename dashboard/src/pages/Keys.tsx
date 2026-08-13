import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { Copy, Trash2, Plus, Eye, EyeOff } from 'lucide-react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../components/ui/select'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog'
import { Input } from '../components/ui/input'
import { Checkbox } from '../components/ui/checkbox'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import ApiKeyButtons from '../components/ApiKeyButtons'
import { Skeleton } from '../components/ui/skeleton'

interface ApiKeyInfo {
  id: string
  key_prefix: string
  key: string
  name: string
  is_active: boolean
  expires_at: string | null
  created_at: string
  last_used_at: string | null
}

const EXPIRATION_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: '6 months', value: 180 },
  { label: '1 year', value: 365 },
  { label: 'No expiration', value: 0 },
]

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString()
}

function isExpired(dateStr: string | null) {
  if (!dateStr) return false
  return new Date(dateStr) < new Date()
}

function maskKey(key: string) {
  const parts = key.split('-')
  if (parts.length < 4) return key.slice(0, 8) + '...'
  const prefix = parts.slice(0, 3).join('-')
  const secret = parts.slice(3).join('-')
  return `${prefix}-${'*'.repeat(secret.length)}`
}

export default function Keys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [expirationDays, setExpirationDays] = useState(30)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [backedUp, setBackedUp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [newKeyName, setNewKeyName] = useState('default')
  const [newKeyExpirationDays, setNewKeyExpirationDays] = useState(30)
  const [loading, setLoading] = useState(true)

  const loadKeys = () => {
    api.listKeys().then((d) => setKeys(d.keys)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { loadKeys() }, [])

  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys((prev) => ({ ...prev, [keyId]: !prev[keyId] }))
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const expires_at = expirationDays > 0
        ? new Date(Date.now() + expirationDays * 86400000).toISOString()
        : undefined
      const d = await api.createKey(createName || 'default', expires_at)
      setNewKey(d.key)
      setNewKeyName(createName || 'default')
      setNewKeyExpirationDays(expirationDays)
      setBackedUp(false)
      setCopied(false)
      setShowCreateDialog(false)
      setCreateName('')
      setExpirationDays(30)
      loadKeys()
    } catch (e: any) {
      toast.error(e.message)
    }
    setCreating(false)
  }

  const handleRegenerate = async () => {
    setCreating(true)
    try {
      const expires_at = newKeyExpirationDays > 0
        ? new Date(Date.now() + newKeyExpirationDays * 86400000).toISOString()
        : undefined
      const d = await api.createKey(newKeyName, expires_at)
      setNewKey(d.key)
      setBackedUp(false)
      setCopied(false)
      loadKeys()
    } catch (e: any) {
      toast.error(e.message)
    }
    setCreating(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(newKey!)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    try {
      await api.revokeKey(revokeTarget)
      loadKeys()
    } catch (e: any) {
      toast.error(e.message)
    }
    setRevokeTarget(null)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-zinc-100">API Keys</h2>
          <ApiKeyButtons />
        </div>
        <AlertDialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <AlertDialogTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors">
              <Plus size={18} />
              New Key
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create API Key</AlertDialogTitle>
              <AlertDialogDescription>Add a remark and set an expiration period.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="e.g. Production, dev server, CI/CD ..."
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                autoFocus
              />
              <Select value={String(expirationDays)} onValueChange={(v) => setExpirationDays(Number(v))}>
                <SelectTrigger className="w-full border-zinc-700 bg-zinc-900 text-sm text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <AlertDialog open={!!newKey} onOpenChange={(open) => { if (!open) { setNewKey(null); setBackedUp(false); setCopied(false) } }}>
        <AlertDialogContent className="max-w-md bg-zinc-900 p-8 dark:bg-zinc-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-white">
              Generate Secret Key
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-sm leading-relaxed text-gray-500">
              For security, this key will only be shown once. Please store it in a safe place.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-6 flex min-w-0 items-center justify-between overflow-hidden rounded-xl bg-zinc-800 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-600 bg-zinc-800 text-gray-500">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-100">
                  API Access Token
                </div>
                <div className="truncate text-sm text-gray-400 underline decoration-gray-300 underline-offset-2">
                  {newKey}
                </div>
              </div>
            </div>

            <button
              onClick={handleCopy}
              className="ml-3 shrink-0 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2.5">
            <Checkbox
              id="backedUp"
              checked={backedUp}
              onCheckedChange={(checked) => setBackedUp(!!checked)}
            />
            <label
              htmlFor="backedUp"
              className="select-none text-sm text-gray-600"
            >
              I have backed up my secret key.
            </label>
          </div>

          <div className="mt-6 flex items-center gap-3">
            {/* <button
              type="button"
              onClick={handleRegenerate}
              disabled={creating}
              className="w-1/2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {creating ? 'Generating...' : 'Regenerate'}
            </button> */}
            <button
              type="button"
              disabled={!backedUp || creating}
              onClick={() => { setNewKey(null); setBackedUp(false); setCopied(false) }}
              className="w-full rounded-xl bg-(--primary-color) py-2.5 text-sm font-semibold text-(--primary-foreground)
               hover:bg-(--primary-color-hover) transition-colors disabled:opacity-50"
            >
              Done
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <div className="hidden md:block overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="max-w-[280px]">Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [0, 1, 2, 3].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-52" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-zinc-600">No API keys yet</TableCell>
              </TableRow>
            ) : null}
            {!loading && keys.map((k) => {
              const expired = isExpired(k.expires_at)
              const statusClass = !k.is_active
                ? 'bg-zinc-800 text-zinc-500'
                : expired
                  ? 'bg-red-900/50 text-red-400'
                  : 'bg-green-900/50 text-green-400'
              const statusLabel = !k.is_active ? 'Revoked' : expired ? 'Expired' : 'Active'
              const visible = visibleKeys[k.id]
              return (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell className="max-w-70">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs break-all max-w-50 w-200px">
                        {visible ? k.key : maskKey(k.key)}
                      </code>
                      <button
                        onClick={() => toggleKeyVisibility(k.id)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                        title={visible ? 'Hide key' : 'Show full key'}
                      >
                        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(k.key)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                        title="Copy key"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusClass}`}>{statusLabel}</span>
                  </TableCell>
                  <TableCell className="text-zinc-500">{formatDate(k.expires_at)}</TableCell>
                  <TableCell className="text-zinc-500">{formatDate(k.created_at)}</TableCell>
                  <TableCell className="text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</TableCell>
                  <TableCell>
                    <AlertDialog open={revokeTarget === k.id} onOpenChange={(open) => setRevokeTarget(open ? k.id : null)}>
                      <AlertDialogTrigger asChild>
                        <button className="p-2 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
                          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleRevoke} className="bg-red-600 hover:bg-red-700">Revoke</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-600">
            No API keys yet
          </div>
        ) : null}
        {!loading && keys.map((k) => {
          const expired = isExpired(k.expires_at)
          const statusClass = !k.is_active
            ? 'bg-zinc-800 text-zinc-500'
            : expired
              ? 'bg-red-900/50 text-red-400'
              : 'bg-green-900/50 text-green-400'
          const statusLabel = !k.is_active ? 'Revoked' : expired ? 'Expired' : 'Active'
          const visible = visibleKeys[k.id]
          return (
            <div key={k.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-100 truncate">{k.name}</div>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs mt-1 ${statusClass}`}>{statusLabel}</span>
                </div>
                <AlertDialog open={revokeTarget === k.id} onOpenChange={(open) => setRevokeTarget(open ? k.id : null)}>
                  <AlertDialogTrigger asChild>
                    <button className="p-2 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors shrink-0">
                      <Trash2 size={16} />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRevoke} className="bg-red-600 hover:bg-red-700">Revoke</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <code className="flex-1 font-mono text-xs break-all text-zinc-400">
                  {visible ? k.key : maskKey(k.key)}
                </code>
                <button
                  onClick={() => toggleKeyVisibility(k.id)}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 shrink-0"
                  title={visible ? 'Hide key' : 'Show full key'}
                >
                  {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={() => copyToClipboard(k.key)}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 shrink-0"
                  title="Copy key"
                >
                  <Copy size={14} />
                </button>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="text-zinc-500">Expires</div>
                <div className="text-zinc-300 text-right">{formatDate(k.expires_at)}</div>
                <div className="text-zinc-500">Created</div>
                <div className="text-zinc-300 text-right">{formatDate(k.created_at)}</div>
                <div className="text-zinc-500">Last Used</div>
                <div className="text-zinc-300 text-right">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</div>
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}
