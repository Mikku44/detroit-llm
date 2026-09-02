import fs from 'node:fs'
import path from 'node:path'

const dist = path.resolve('dist')
const indexPath = path.join(dist, 'index.html')
if (!fs.existsSync(indexPath)) {
  console.error('[prerender] dist/index.html not found, skip')
  process.exit(0)
}
let html = fs.readFileSync(indexPath, 'utf8')
if (html.includes('<!--prerendered-->')) {
  console.log('[prerender] already prerendered')
  process.exit(0)
}

const landing = `
<!--prerendered-->
<header class="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/70 backdrop-blur">
  <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
    <a href="/" class="flex items-center gap-2"><img src="/logo.png" alt="Detroit LLM" class="h-7 w-7 rounded"/><span class="text-sm font-bold tracking-tight md:text-base text-zinc-100">Detroit LLM</span><span class="hidden rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 md:inline">Gateway</span></a>
    <nav class="hidden items-center gap-6 text-sm text-zinc-400 md:flex"><a href="/#features" class="hover:text-zinc-100">Features</a><a href="/#faq" class="hover:text-zinc-100">FAQ</a><a href="/docs" class="hover:text-zinc-100">Docs</a><a href="/models" class="hover:text-zinc-100">Models</a></nav>
    <a href="/login" class="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white">Sign in</a>
  </div>
</header>
<div class="min-h-screen bg-zinc-950 text-zinc-100">
  <section class="relative flex w-full items-center justify-center overflow-hidden py-16 px-6">
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(54,47,79,0.35),_transparent_60%)]"></div>
    <div class="relative z-10 max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div class="space-y-6">
        <span class="text-sm font-medium text-zinc-500 tracking-wide">Detroit LLM Platform</span>
        <h1 class="text-5xl lg:text-6xl font-serif leading-tight font-normal text-zinc-50">Start building<br/>with Detroit LLM</h1>
        <p class="text-zinc-400 text-lg max-w-md leading-relaxed">Everything you need to integrate Detroit LLM into your applications. From first API call to production.</p>
        <p class="text-zinc-500 text-sm max-w-md leading-relaxed">OpenAI compatible — use your existing SDK via <code class="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">/v1/chat/completions</code></p>
        <div class="flex flex-wrap gap-3 pt-2">
          <a href="/login" class="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-6 py-3 text-sm font-medium text-zinc-900 hover:bg-white">Get started for free →</a>
          <a href="/docs" class="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">View API Docs →</a>
        </div>
      </div>
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 shadow-sm overflow-hidden">
        <div class="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-xs font-medium text-zinc-300"><span class="rounded-md bg-zinc-800 px-3 py-1.5 text-zinc-100">cURL</span><span class="px-2 text-zinc-500">Python</span><span class="px-2 text-zinc-500">TypeScript</span></div>
        <pre class="text-sm leading-relaxed bg-zinc-900 p-6 overflow-x-auto text-zinc-300 font-mono text-xs"><code>curl https://chat.khain.app/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-dt-..." \\
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Hello Detroit LLM"}]
  }'</code></pre>
      </div>
    </div>
  </section>
  <div class="p-8 space-y-16 max-w-6xl mx-auto">
    <section id="features">
      <h2 class="text-2xl font-normal text-zinc-50 mb-2">Why Detroit LLM?</h2>
      <p class="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Everything you need — chat, API, key management and usage in one place.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">Multiple models, one gateway</h3><p class="text-xs text-zinc-400 leading-relaxed">Switch models instantly in chat — DeepSeek for code, Qwen for general tasks, GLM for language — seamless.</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">OpenAI Compatible API</h3><p class="text-xs text-zinc-400 leading-relaxed">Endpoint /v1/chat/completions and /v1/models works with OpenAI SDK, Vercel AI SDK, LangChain instantly.</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">Chat + API Keys + Usage</h3><p class="text-xs text-zinc-400 leading-relaxed">Web chat, API key management, Requests/Tokens/Punchcard graphs and transparent Tier quotas.</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">Fast streaming</h3><p class="text-xs text-zinc-400 leading-relaxed">Go Gateway + SGLang for low latency streaming just like OpenAI.</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">MIKKUCN membership</h3><p class="text-xs text-zinc-400 leading-relaxed">Linked to YouTube Membership — auto-verified, or subscribe to Paid plan directly.</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><h3 class="text-sm font-medium text-zinc-200 mb-1">Stable LLM Gateway</h3><p class="text-xs text-zinc-400 leading-relaxed">Clear weekly/monthly Tier quotas — no need to top up multiple providers.</p></div>
      </div>
    </section>
    <section id="models">
      <h2 class="text-2xl font-normal text-zinc-50 mb-2">Multiple models — pick the right one for the job</h2>
      <p class="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Choose the model that excels at each task and switch seamlessly in one chat.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">deepseek-v4-flash</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Fast</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">DeepSeek V4 Flash — fast for everyday Q&amp;A and high-volume tasks</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">1M context</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">304B</span></div></div></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">deepseek-v4-pro</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Flagship</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">DeepSeek V4 Pro — most capable for reasoning, code and production</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">1M context</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">304B</span></div></div></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">qwen3.7-flash</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Fast</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">Qwen 3.7 Flash — fast with thinking mode for stronger reasoning</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">128K context</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">—</span></div></div></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">z-image-turbo</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Image</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">z-image-turbo — high-quality 1024×1024 image generation</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">1024×1024</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">—</span></div></div></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">glm-5.3</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Reasoning</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">GLM-5.3 — 1M context / max 128K output</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">1M context</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">128K max</span></div></div></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex items-center justify-between mb-2 gap-2"><code class="font-mono text-sm text-zinc-100 truncate">glm-4.7-flashx</code><span class="text-[10px] uppercase tracking-wide text-zinc-500">Reasoning</span></div><p class="text-sm text-zinc-400 mb-4 leading-relaxed">GLM-4.7-FlashX — fast and efficient</p><div class="space-y-1.5 border-t border-zinc-800 pt-3 text-xs"><div class="flex justify-between"><span class="text-zinc-500">Context</span><span class="text-zinc-300">131K max</span></div><div class="flex justify-between"><span class="text-zinc-500">Size</span><span class="text-zinc-300">65K default</span></div></div></div>
      </div>
      <p class="mt-4 text-xs text-zinc-500">See all: <code class="font-mono text-xs text-zinc-300">GET https://chat.khain.app/v1/models</code></p>
    </section>
    <section>
      <h2 class="text-2xl font-normal text-zinc-50 mb-2">Get started in 3 steps</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 text-sm font-bold">1</div><h3 class="text-sm font-medium text-zinc-200 mt-3">Sign in with Google</h3><p class="text-xs text-zinc-400 leading-relaxed mt-1">Auto-verifies YouTube Membership or choose a Paid plan</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 text-sm font-bold">2</div><h3 class="text-sm font-medium text-zinc-200 mt-3">Get your API key</h3><p class="text-xs text-zinc-400 leading-relaxed mt-1">Create a key on the Keys page and use it with OpenAI SDK</p></div>
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 text-sm font-bold">3</div><h3 class="text-sm font-medium text-zinc-200 mt-3">Pick a model and chat</h3><p class="text-xs text-zinc-400 leading-relaxed mt-1">Switch models per task and monitor usage in real time</p></div>
      </div>
    </section>
    <section id="faq">
      <h2 class="text-2xl font-normal text-zinc-50 mb-2">FAQ</h2>
      <p class="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">Everything you need to know about Detroit LLM</p>
      <div class="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div class="p-5"><h3 class="text-sm font-medium text-zinc-100">What is Detroit LLM?</h3><p class="text-sm leading-relaxed text-zinc-400 mt-2">Detroit LLM is an AI Chat Platform and LLM Gateway that lets you chat with multiple AI models in one place with seamless model switching via OpenAI-compatible API.</p></div>
        <div class="p-5"><h3 class="text-sm font-medium text-zinc-100">Which models are supported?</h3><p class="text-sm leading-relaxed text-zinc-400 mt-2">Currently supports deepseek-v4-flash, deepseek-v4-pro, qwen3.7-flash, z-image-turbo, glm-5.3 and more. See the full list at /v1/models or the Models page.</p></div>
        <div class="p-5"><h3 class="text-sm font-medium text-zinc-100">Does it work with existing OpenAI code?</h3><p class="text-sm leading-relaxed text-zinc-400 mt-2">Yes. Just change base_url to https://chat.khain.app/v1 and use your Detroit LLM API key. Existing OpenAI SDK code works without changes.</p></div>
        <div class="p-5"><h3 class="text-sm font-medium text-zinc-100">How do I get started?</h3><p class="text-sm leading-relaxed text-zinc-400 mt-2">Click “Sign in with Google” — we verify your MIKKUCN YouTube Membership or Paid plan, then you get an API key and can start chatting or calling the API immediately.</p></div>
        <div class="p-5"><h3 class="text-sm font-medium text-zinc-100">How does pricing work?</h3><p class="text-sm leading-relaxed text-zinc-400 mt-2">Access is tier-based: YouTube members and Paid plans get different weekly/monthly token quotas. See details on the Upgrade plan after signing in.</p></div>
      </div>
    </section>
    <section>
      <div class="relative overflow-hidden rounded-xl border border-zinc-800 p-8 text-center bg-zinc-900/50">
        <h2 class="text-2xl font-normal text-zinc-50">Ready to try Detroit LLM?</h2>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <a href="/login" class="inline-flex items-center justify-center rounded-lg bg-zinc-100 px-8 py-3 text-sm font-medium text-zinc-900 hover:bg-white">Sign in with Google</a>
          <a href="https://discord.gg/KuMVmcK3cC" target="_blank" rel="noreferrer" class="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Join Discord</a>
        </div>
      </div>
    </section>
  </div>
  <footer class="border-t border-zinc-800 bg-zinc-900/30">
    <div class="mx-auto max-w-6xl px-8 py-10">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
        <div><div class="flex items-center gap-2"><img src="/logo.png" alt="Detroit LLM" class="h-6 w-6 rounded"/><span class="text-sm font-bold text-zinc-100">Detroit LLM</span></div><p class="mt-3 text-xs leading-relaxed text-zinc-500">Everything you need — chat, API, key management and usage in one place.</p></div>
        <div><div class="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Product</div><div class="mt-3 flex flex-col gap-2 text-xs text-zinc-500"><a href="/#features" class="hover:text-zinc-300">Features</a><a href="/#models" class="hover:text-zinc-300">Models</a><a href="/docs" class="hover:text-zinc-300">Docs</a><a href="/login" class="hover:text-zinc-300">Sign in</a></div></div>
        <div><div class="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Resources</div><div class="mt-3 flex flex-col gap-2 text-xs text-zinc-500"><a href="/docs" class="hover:text-zinc-300">API Reference</a><a href="https://discord.gg/KuMVmcK3cC" target="_blank" rel="noreferrer" class="hover:text-zinc-300">Discord</a><a href="/models" class="hover:text-zinc-300">Models</a></div></div>
        <div><div class="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Legal</div><div class="mt-3 flex flex-col gap-2 text-xs text-zinc-500"><a href="/privacy" class="hover:text-zinc-300">Privacy Policy</a><a href="/terms" class="hover:text-zinc-300">Terms of Use</a></div></div>
      </div>
      <div class="mt-10 flex flex-col gap-2 border-t border-zinc-800 pt-6 md:flex-row md:items-center md:justify-between"><div class="text-xs text-zinc-600">© 2026 Detroit LLM — MIKKUCN • chat.khain.app</div><div class="text-xs text-zinc-600">Everything you need to integrate Detroit LLM into your applications.</div></div>
    </div>
  </footer>
</div>
`.trim()

html = html.replace(/<div id="root"><\/div>/, `<div id="root">${landing}</div>`)

fs.writeFileSync(indexPath, html)
console.log('[prerender] injected landing into dist/index.html (' + Buffer.byteLength(html) + ' bytes)')

for (const route of ['docs', 'models', 'privacy', 'terms', 'privacy-policy', 'terms-of-use']) {
  const dir = path.join(dist, route)
  fs.mkdirSync(dir, { recursive: true })
  const copyPath = path.join(dir, 'index.html')
  if (!fs.existsSync(copyPath)) {
    fs.writeFileSync(copyPath, html)
    console.log('[prerender] copied -> ' + route + '/index.html')
  }
}
