import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FiCopy, FiCheck } from 'react-icons/fi'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth'
import PixelBlast from '../components/PixelBlast'
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
      {"role": "user", "content": "สวัสดี Detroit LLM"}
    ]
  }'`,
  Python: `from openai import OpenAI

client = OpenAI(
  base_url="${API_BASE}/v1",
  api_key="${KEY_PLACEHOLDER}"
)

res = client.chat.completions.create(
  model="${DEFAULT_MODEL}",
  messages=[{"role": "user", "content": "สวัสดี Detroit LLM"}]
)
print(res.choices[0].message.content)`,
  TypeScript: `import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "${API_BASE}/v1",
  apiKey: "${KEY_PLACEHOLDER}"
})

const res = await client.chat.completions.create({
  model: "${DEFAULT_MODEL}",
  messages: [{ role: "user", content: "สวัสดี Detroit LLM" }]
})
console.log(res.choices[0].message.content)`,
}

const LANG: Record<string, string> = { cURL: 'bash', Python: 'python', TypeScript: 'typescript' }
const tabs = ['cURL', 'Python', 'TypeScript']

export default function Landing() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('cURL')
  const [copied, setCopied] = useState(false)
  const [faqOpen, setFaqOpen] = useState<number | null>(0)

  useEffect(() => {
    document.title = 'Detroit LLM | แพลตฟอร์ม AI Chat สำหรับสมาชิก MIKKUCN'
  }, [])

  const faqs = [
    { q: 'Detroit LLM คืออะไร?', a: 'Detroit LLM คือแพลตฟอร์ม AI Chat และ LLM Gateway สำหรับสมาชิก MIKKUCN ที่ให้คุณแชทกับ AI หลายโมเดลในที่เดียว เลือกโมเดลให้เหมาะกับงานแต่ละแบบได้อย่าง seamless ผ่านอินเทอร์เฟซแชทและ OpenAI-compatible API' },
    { q: 'รองรับโมเดลอะไรบ้าง?', a: 'ปัจจุบันรองรับ deepseek-v4-flash, deepseek-v4-pro, qwen3.7-flash, z-image-turbo, glm-5.3 และอีกหลายโมเดล ดูรายการล่าสุดได้ที่ /v1/models หรือหน้า Models' },
    { q: 'ใช้งานกับโค้ดเดิมที่เป็น OpenAI ได้ไหม?', a: 'ได้ทันที เพียงเปลี่ยน base_url เป็น https://chat.khain.app/v1 และใช้ API Key จาก Detroit LLM โค้ด OpenAI SDK เดิมทำงานได้โดยไม่ต้องแก้ messages format' },
    { q: 'สมัครใช้งานอย่างไร?', a: 'คลิก “เข้าสู่ระบบด้วย Google” ระบบตรวจสอบ YouTube Membership ของช่อง MIKKUCN หรือเลือกอัปเกรดเป็นแพ็กเกจ Paid รับ API Key แล้วเริ่มแชทหรือเรียก API ได้เลย' },
    { q: 'มีค่าใช้จ่ายอย่างไร?', a: 'สิทธิ์ตาม Tier: สมาชิก YouTube และแพ็กเกจ Paid จะได้โควตา token รายสัปดาห์/เดือน ต่างกัน ดูรายละเอียดที่หน้า Upgrade plan หลังล็อกอิน' },
  ]

  const codeText = CODE[activeTab] || CODE.cURL

  return (
    <div className="min-h-screen  bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40  bg-zinc-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex gap-4">
            <a href="/" className="flex items-center gap-2">
              <img src="/logo.png" alt="Detroit LLM" className="h-7 w-7 rounded" />
              <span className="text-sm font-bold tracking-tight md:text-base">Detroit LLM</span>
              <span className="hidden rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 md:inline">MIKKUCN</span>
            </a>
            <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
              <a href="#features" className="hover:text-zinc-100">ฟีเจอร์</a>
              <a href="#models" className="hover:text-zinc-100">โมเดล</a>
              <a href="#faq" className="hover:text-zinc-100">FAQ</a>
              <Link to="/docs" className="hover:text-zinc-100">Docs</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {user ? <Link to="/" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">ไปที่ Dashboard</Link> : <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white">เข้าสู่ระบบ</Link>}
          </div>
        </div>
      </header>

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
        <div className="relative z-10 max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center px-8">
            <div className="space-y-6">
              <span className="text-sm font-medium text-zinc-500 tracking-wide">Detroit LLM Platform</span>
              <h1 className="text-5xl lg:text-6xl  leading-tight font-normal text-zinc-50">
                Detroit LLM<br />
              
              </h1>
             
              <p className="text-zinc-500 text-sm max-w-md leading-relaxed">
                API เข้ากันได้กับ OpenAI SDK ใช้งานโค้ดเดิมได้ทันที ผ่าน <code className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">/v1/chat/completions</code>
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-6 py-3 text-sm font-medium text-zinc-900 hover:bg-white">เริ่มต้นใช้งานฟรี</Link>
                <Link to="/docs" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">ดู API Docs</Link>
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
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">ทำไมต้อง Detroit LLM?</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">แพลตฟอร์มเดียวที่รวมแชท + API + จัดการคีย์ + ดู usage ครบในที่เดียว</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { t: 'หลายโมเดล เลือกตามงาน', d: 'สลับโมเดลได้ทันทีในแชท เลือก DeepSeek สำหรับโค้ด Qwen สำหรับงานทั่วไป GLM สำหรับภาษาไทย — seamless' },
              { t: 'OpenAI Compatible API', d: 'Endpoint /v1/chat/completions และ /v1/models ใช้ OpenAI SDK, Vercel AI SDK, LangChain ได้ทันที' },
              { t: 'แชท + API Key + Usage', d: 'แชทบนเว็บ จัดการ API Key ดูกราฟ Requests/Tokens/Punchcard และโควตา Tier แบบโปร่งใส' },
              { t: 'Streaming เร็ว', d: 'Go Gateway + SGLang ให้ latency ต่ำ รองรับ streaming แบบเดียวกับ OpenAI' },
              { t: 'สิทธิ์สมาชิก MIKKUCN', d: 'ผูกกับ YouTube Membership ตรวจสอบอัตโนมัติ หรือสมัคร Paid Plan ได้โดยตรง' },
              { t: 'LLM Gateway เสถียร', d: 'โควตา Tier รายสัปดาห์/เดือน ชัดเจน ไม่ต้องเติมเครดิตหลายเจ้า เหมาะกับผู้ใช้ไทย' },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h4 className="text-sm font-medium text-zinc-200 mb-1">{f.t}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="models" className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">รองรับหลายโมเดล — เลือกให้เหมาะกับงาน</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">เหมือน OpenRouter ที่ให้คุณเลือกโมเดลที่เก่งแต่ละด้าน Detroit LLM ก็ให้คุณสลับโมเดลได้แบบ seamless</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: 'deepseek-v4-flash', tag: 'Fast', desc: 'DeepSeek V4 Flash — เร็ว เหมาะกับงานทั่วไป Q&A ปริมาณมาก', ctx: '1M context', size: '304B' },
              { id: 'deepseek-v4-pro', tag: 'Flagship', desc: 'DeepSeek V4 Pro — เก่งสุด สำหรับ reasoning โค้ด และงานโปรดักชัน', ctx: '1M context', size: '304B' },
              { id: 'qwen3.7-flash', tag: 'Fast', desc: 'Qwen 3.7 Flash — เร็ว มี thinking mode สำหรับ reasoning', ctx: '128K context', size: '—' },
              { id: 'z-image-turbo', tag: 'Image', desc: 'z-image-turbo — สร้างรูปภาพ 1024×1024 คุณภาพสูง', ctx: '1024×1024', size: '—' },
              { id: 'glm-5.3', tag: 'Reasoning', desc: 'GLM-5.3 — 1M context / max 128K output', ctx: '1M context', size: '128K max' },
              { id: 'glm-4.7-flashx', tag: 'Reasoning', desc: 'GLM-4.7-FlashX — เร็วและประหยัด', ctx: '131K max', size: '65K default' },
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
          <p className="mt-4 text-xs text-zinc-500">ดูรายการทั้งหมด: <code className="font-mono text-xs text-zinc-300">GET {API_BASE}/v1/models</code></p>
        </section>

        <section className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">เริ่มต้นใน 3 ขั้นตอน</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">1</div><h4 className="text-sm font-medium text-zinc-200 mt-3">เข้าสู่ระบบด้วย Google</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">เชื่อม YouTube Membership อัตโนมัติ หรือเลือก Paid Plan</p></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">2</div><h4 className="text-sm font-medium text-zinc-200 mt-3">รับ API Key</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">สร้างคีย์ที่หน้า Keys แล้วนำไปใส่ในโค้ด OpenAI SDK</p></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-(--primary-color) text-(--primary-foreground) text-sm font-bold">3</div><h4 className="text-sm font-medium text-zinc-200 mt-3">เลือกโมเดลแล้วแชท</h4><p className="text-xs text-zinc-400 leading-relaxed mt-1">สลับโมเดลตามงาน ดู usage แบบเรียลไทม์</p></div>
          </div>
        </section>

        <section id="faq" className="max-w-6xl w-full mx-auto">
          <h2 className="text-2xl  font-normal text-zinc-50 mb-2">คำถามที่พบบ่อย</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">ทุกสิ่งที่คุณต้องรู้เกี่ยวกับ Detroit LLM</p>
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
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <h2 className="text-2xl  font-normal text-zinc-50">พร้อมลอง Detroit LLM แล้วหรือยัง?</h2>
           
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/login" className="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-8 py-3 text-sm font-medium text-zinc-900 hover:bg-white">เข้าสู่ระบบด้วย Google</Link>
              <a href="https://discord.gg/KuMVmcK3cC" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">เข้าร่วม Discord</a>
            </div>
          </div>
        </section>

        <footer className="max-w-6xl w-full mx-auto border-t border-zinc-800 pt-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-zinc-500">
              <div className="font-medium text-zinc-300">Detroit LLM</div>
              <div className="mt-1 text-xs leading-relaxed">Detroit LLM แพลตฟอร์ม AI Chat สำหรับสมาชิก MIKKUCN รองรับ AI หลายโมเดลและเลือกโมเดลให้เหมาะกับงานแบบ seamless<br />OpenRouter alternative • LLM Gateway • AI Gateway Thailand</div>
            </div>
            <div className="flex gap-4 text-xs text-zinc-500">
              <Link to="/docs" className="hover:text-zinc-300">Docs</Link>
              <Link to="/models" className="hover:text-zinc-300">Models</Link>
              <a href="/privacy-policy.md" className="hover:text-zinc-300">Privacy</a>
              <a href="/terms-of-use.md" className="hover:text-zinc-300">Terms</a>
            </div>
          </div>
          <div className="mt-4 text-xs text-zinc-600">© {new Date().getFullYear()} Detroit LLM — MIKKUCN • chat.khain.app</div>
        </footer>
      </div>
    </div>
  )
}
