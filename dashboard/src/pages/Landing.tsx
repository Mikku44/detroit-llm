import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FiCopy, FiCheck } from 'react-icons/fi'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import PixelBlast from '../components/PixelBlast'
import PublicNavbar from '../components/PublicNavbar'
import PublicFooter from '../components/PublicFooter'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('bash', bash)

const API_BASE = 'https://chat.khain.app'
const KEY_PLACEHOLDER = 'sk-dt-...'
const DEFAULT_MODEL = 'deepseek-v4-flash'

const CODE: Record<string, string> = {
  cURL: `curl ${API_BASE}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -d '{
    "model": "${DEFAULT_MODEL}",
    "messages": [
      {"role": "user", "content": "Hello Detroit LLM"}
    ]
  }'`,
  Python: `from openai import OpenAI

client = OpenAI(
  base_url="${API_BASE}/v1",
  api_key="${KEY_PLACEHOLDER}"
)

res = client.chat.completions.create(
  model="${DEFAULT_MODEL}",
  messages=[{"role": "user", "content": "Hello Detroit LLM"}]
)
print(res.choices[0].message.content)`,
  TypeScript: `import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "${API_BASE}/v1",
  apiKey: "${KEY_PLACEHOLDER}"
})

const res = await client.chat.completions.create({
  model: "${DEFAULT_MODEL}",
  messages: [{ role: "user", content: "Hello Detroit LLM" }]
})
console.log(res.choices[0].message.content)`,
}

const LANG: Record<string, string> = { cURL: 'bash', Python: 'python', TypeScript: 'typescript' }
const tabs = ['cURL', 'Python', 'TypeScript']

export default function Landing() {
  const [activeTab, setActiveTab] = useState('cURL')
  const [copied, setCopied] = useState(false)
  const [faqOpen, setFaqOpen] = useState<number | null>(0)

  useEffect(() => {
    document.title = 'Detroit LLM Gateway | AI Chat Platform & OpenAI Compatible API'
  }, [])

  const faqs = [
    { q: 'What is Detroit LLM?', a: 'Detroit LLM is an AI Chat Platform and LLM Gateway that lets you chat with multiple AI models in one place with seamless model switching via OpenAI-compatible API.' },
    { q: 'Which models are supported?', a: 'Currently supports deepseek-v4-flash, deepseek-v4-pro, qwen3.7-flash, qwen3.8-flash, z-image-turbo, glm-5.3 and more. See the full list at /v1/models or the Models page.' },
    { q: 'Does it work with existing OpenAI code?', a: 'Yes. Just change base_url to https://chat.khain.app/v1 and use your Detroit LLM API key. Existing OpenAI SDK code works without changes.' },
    { q: 'How do I get started?', a: 'Click “Sign in with Google” — we verify your MIKKUCN YouTube Membership or Paid plan, then you get an API key and can start chatting or calling the API immediately.' },
    { q: 'How does pricing work?', a: 'Access is tier-based: YouTube members and Paid plans get different weekly/monthly token quotas. See details on the Upgrade plan after signing in.' },
  ]

  const codeText = CODE[activeTab] || CODE.cURL

  return (
    <div className="min-h-screen scroll-smooth bg-zinc-950 text-zinc-100">
      <PublicNavbar />

      <div className="relative flex w-full items-center justify-center overflow-hidden py-16">
        <div className="absolute max-h-[800px] max-w-[800px]">
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
        <div className="absolute inset-0 bg-zinc-950/20 pointer-events-none z-[1]" />
        <div className="relative z-10 max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <span className="text-sm font-medium text-zinc-500 tracking-wide">Detroit LLM Platform</span>
              <h1 className="text-5xl lg:text-6xl font-serif leading-tight font-normal text-zinc-50">
                Start building <br />
                with Detroit LLM
              </h1>
              <p className="text-zinc-400 text-lg max-w-md leading-relaxed">
                Everything you need to integrate Detroit LLM into your applications. From first API call to production.
              </p>
              <p className="text-zinc-500 text-sm max-w-md leading-relaxed">
                OpenAI compatible — use your existing SDK via <code className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">/v1/chat/completions</code>
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-6 py-3 text-sm font-medium text-zinc-900 hover:bg-white">Get started for free →</Link>
              <Link to="/docs" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">View API Docs →</Link>
              </div>

            </div>

            <div className="bg-zinc-900 rounded-xl border border-zinc-800 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 pt-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="h-9 gap-1 bg-transparent p-0 text-zinc-500">
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab} value={tab} className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none">{tab}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <Button onClick={() => { navigator.clipboard.writeText(codeText); setCopied(true); setTimeout(() => setCopied(false), 2000) }} variant="ghost" size="icon" className="text-zinc-500 hover:text-zinc-300" title="Copy code">
                  {copied ? <FiCheck className="text-green-500" /> : <FiCopy />}
                </Button>
              </div>
              <div className="text-sm leading-relaxed bg-zinc-900 overflow-x-auto">
                <SyntaxHighlighter language={LANG[activeTab] || 'bash'} style={vscDarkPlus} customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent', fontSize: '0.875rem', lineHeight: '1.625' }} codeTagProps={{ style: { fontFamily: 'inherit' } }}>
                  {codeText}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>
        </div>
      <div className="p-8  space-y-16">

        <section id="features" className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">Why Detroit LLM?</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Everything you need — chat, API, key management and usage in one place.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { t: 'Multiple models, one gateway', d: 'Switch models instantly in chat — DeepSeek for code, Qwen for general tasks, GLM for language — seamless.' },
              { t: 'OpenAI Compatible API', d: 'Endpoint /v1/chat/completions and /v1/models works with OpenAI SDK, Vercel AI SDK, LangChain instantly.' },
              { t: 'Chat + API Keys + Usage', d: 'Web chat, API key management, Requests/Tokens/Punchcard graphs and transparent Tier quotas.' },
              { t: 'Fast streaming', d: 'Go Gateway + SGLang for low latency streaming just like OpenAI.' },
              { t: 'MIKKUCN membership', d: 'Linked to YouTube Membership — auto-verified, or subscribe to Paid plan directly.' },
              { t: 'Stable LLM Gateway', d: 'Clear weekly/monthly Tier quotas — no need to top up multiple providers.' },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h4 className="text-sm font-medium text-zinc-200 mb-1">{f.t}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="models" className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">Multiple models — pick the right one for the job</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Choose the model that excels at each task and switch seamlessly in one chat.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: 'deepseek-v4-flash', tag: 'Fast', desc: 'DeepSeek V4 Flash — fast for everyday Q&A and high-volume tasks', ctx: '1M context', size: '304B' },
              { id: 'deepseek-v4-pro', tag: 'Flagship', desc: 'DeepSeek V4 Pro — most capable for reasoning, code and production', ctx: '1M context', size: '304B' },
              { id: 'qwen3.7-flash', tag: 'Fast', desc: 'Qwen 3.7 Flash — fast with thinking mode for stronger reasoning', ctx: '128K context', size: '—' },
              { id: 'qwen3.8-flash', tag: 'Fast', desc: 'Qwen 3.8 Flash — fast with thinking mode for stronger reasoning', ctx: '128K context', size: '—' },
              { id: 'z-image-turbo', tag: 'Image', desc: 'z-image-turbo — high-quality 1024×1024 image generation', ctx: '1024×1024', size: '—' },
              { id: 'glm-5.3', tag: 'Reasoning', desc: 'GLM-5.3 — 1M context / max 128K output', ctx: '1M context', size: '128K max' },
              { id: 'glm-4.7-flashx', tag: 'Reasoning', desc: 'GLM-4.7-FlashX — fast and efficient', ctx: '131K max', size: '65K default' },
            ].map((m) => (
              <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <code className="font-mono text-sm text-zinc-100 truncate">{m.id}</code>
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">{m.tag}</span>
                </div>
                <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{m.desc}</p>
                <div className="space-y-1.5 border-t border-zinc-800 pt-3 text-xs">
                  <div className="flex justify-between"><span className="text-zinc-500">Context</span><span className="text-zinc-300">{m.ctx}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Size</span><span className="text-zinc-300">{m.size}</span></div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-500">See all: <code className="font-mono text-xs text-zinc-300">GET {API_BASE}/v1/models</code></p>
        </section>

        <section className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">Get started in 3 steps</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">1</div><h4 className="text-sm font-medium text-zinc-200 mt-3">Sign in with Google</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">Auto-verifies YouTube Membership or choose a Paid plan</p></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">2</div><h4 className="text-sm font-medium text-zinc-200 mt-3">Get your API key</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">Create a key on the Keys page and use it with OpenAI SDK</p></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">3</div><h4 className="text-sm font-medium text-zinc-200 mt-3">Pick a model and chat</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">Switch models per task and monitor usage in real time</p></div>
          </div>
        </section>

        <section id="faq" className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">FAQ</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Everything you need to know about Detroit LLM</p>
          <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            {faqs.map((f, i) => {
              const open = faqOpen === i
              return (
                <div key={i} role="button" tabIndex={0} onClick={() => setFaqOpen(open ? null : i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFaqOpen(open ? null : i) } }} className="cursor-pointer p-5 hover:bg-zinc-900 transition-colors">
                  <div className="flex w-full items-center justify-between text-left">
                    <span className="pr-4 text-sm font-medium text-zinc-100">{f.q}</span>
                    <span className={`shrink-0 text-zinc-500 transition-transform duration-300 ${open ? 'rotate-45' : 'rotate-0'}`}>{open ? '−' : '+'}</span>
                  </div>
                  <div className={`grid transition-all duration-300 ease-in-out ${open ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <p className="text-sm leading-relaxed text-zinc-400">{f.a}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="max-w-6xl w-full mx-auto">
          <div className="relative overflow-hidden rounded-xl border border-zinc-800 p-8 text-center">
            <div className="absolute h-[300px] max-w-[800px] mx-auto w-full">
              <PixelBlast
                variant="square"
                pixelSize={6}
                color="#362F4F"
                className=""
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
            <div className="absolute inset-0 bg-zinc-950/30 pointer-events-none z-[1]" />
            <div className="relative z-10">
              <h2 className="text-2xl font-normal text-zinc-50">Ready to try Detroit LLM?</h2>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-8 py-3 text-sm font-medium text-zinc-900 hover:bg-white">Sign in with Google</Link>
                <a href="https://discord.gg/KuMVmcK3cC" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/80 backdrop-blur px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Join Discord</a>
              </div>
            </div>
          </div>
        </section>

      </div>
      <PublicFooter />
    </div>
  )
}
