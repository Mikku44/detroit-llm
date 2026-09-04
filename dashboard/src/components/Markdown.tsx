import { memo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { FiCopy, FiCheck } from 'react-icons/fi'
import { LinkTooltip } from './LinkTooltip'
import { GlowImage } from './GlowImage'
import CodeArtifact, { isPreviewableLanguage } from './chat/CodeArtifact'

import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import markdownLang from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'

SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('xml', markup)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('yml', yaml)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('ruby', ruby)
SyntaxHighlighter.registerLanguage('php', php)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('cs', csharp)
SyntaxHighlighter.registerLanguage('c', c)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('swift', swift)
SyntaxHighlighter.registerLanguage('kotlin', kotlin)
SyntaxHighlighter.registerLanguage('dockerfile', docker)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('markdown', markdownLang)

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = () => {
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isPreviewableLanguage(language) && code.trim().length > 0) {
    return <CodeArtifact language={language} code={code} />
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3.5 py-1.5">
        <span className="font-mono text-[11px] lowercase text-zinc-500">{language}</span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
          title="Copy code"
        >
          {copied ? <FiCheck size={13} className="text-green-500" /> : <FiCopy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{ margin: 0, padding: '0.875rem 1rem', background: 'transparent', fontSize: '0.8125rem', lineHeight: '1.6' }}
        codeTagProps={{ style: { fontFamily: 'inherit' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="text-[15px] leading-7 text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={(url) => (url.startsWith('data:image/') ? url : defaultUrlTransform(url))}
        components={{
          h1: (props) => <h1 className="mt-5 mb-2 text-xl font-semibold text-zinc-100 first:mt-0" {...props} />,
          h2: (props) => <h2 className="mt-5 mb-2 text-lg font-semibold text-zinc-100 first:mt-0" {...props} />,
          h3: (props) => <h3 className="mt-4 mb-1.5 text-base font-semibold text-zinc-100 first:mt-0" {...props} />,
          h4: (props) => <h4 className="mt-3.5 mb-1 text-base font-medium text-zinc-100 first:mt-0" {...props} />,
          h5: (props) => <h5 className="mt-3 mb-1 text-sm font-semibold text-zinc-100 first:mt-0" {...props} />,
          h6: (props) => <h6 className="mt-3 mb-1 text-sm font-medium text-zinc-300 first:mt-0" {...props} />,
          p: (props) => <p className="my-3 first:mt-0 last:mb-0" {...props} />,
          a: ({ href, children }) =>
            href ? (
              <LinkTooltip href={href}>{children}</LinkTooltip>
            ) : (
              <a
                className="text-white underline underline-offset-2 transition-colors hover:text-zinc-200"
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
            ),
          blockquote: (props) => (
            <blockquote className="my-3 border-s-2 border-zinc-600 ps-4 text-zinc-400" {...props} />
          ),
          ul: (props) => <ul className="my-3 list-disc ps-5 [&>li]:mt-1" {...props} />,
          ol: (props) => <ol className="my-3 list-decimal ps-5 [&>li]:mt-1" {...props} />,
          li: (props) => <li className="leading-7" {...props} />,
          hr: (props) => <hr className="my-4 border-zinc-800" {...props} />,
          strong: (props) => <strong className="font-semibold text-zinc-100" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          del: (props) => <del className="text-zinc-500 line-through" {...props} />,
          img: ({ node: _node, ...props }) => <GlowImage {...props} />,
          input: (props) => <input type="checkbox" disabled className="mr-2 align-middle accent-(--primary-color)" {...props} />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: (props) => <thead className="bg-zinc-800/70" {...props} />,
          th: (props) => <th className="border border-zinc-700 px-3 py-1.5 text-start font-medium text-zinc-100" {...props} />,
          td: (props) => <td className="border border-zinc-700 px-3 py-1.5 text-zinc-300" {...props} />,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '')
            const isBlock = Boolean(match) || String(children).includes('\n')
            if (isBlock) {
              const language = match?.[1] || 'text'
              const code = String(children).replace(/\n$/, '')
              return <CodeBlock language={language} code={code} />
            }
            return (
              <code
                className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-100"
                {...props}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)

export default Markdown
