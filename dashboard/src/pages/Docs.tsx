import { useEffect, useState } from 'react';
import { FiSearch, FiCopy, FiCheck } from 'react-icons/fi';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { api } from '../lib/api';
import { createElement, PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('bash', bash);

const tabs = ['Python', 'TypeScript', 'Go', 'Java', 'Ruby', 'PHP', 'C#', 'cURL'];

const LANG: Record<string, string> = {
  Python: 'python',
  TypeScript: 'typescript',
  Go: 'go',
  Java: 'java',
  Ruby: 'ruby',
  PHP: 'php',
  'C#': 'csharp',
  cURL: 'bash',
};

const KEY_PLACEHOLDER = '{API_KEY}';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const API_BASE = 'https://chat.khain.app';

const CODE: Record<string, string> = {
  Python: `import json
import urllib.request

url = "${API_BASE}/v1/chat/completions"
headers = {
    "content-type": "application/json",
    "authorization": "Bearer ${KEY_PLACEHOLDER}",
}
body = json.dumps({
    "model": "${DEFAULT_MODEL}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello, Detroit LLM"}],
}).encode()

req = urllib.request.Request(url, data=body, headers=headers)
with urllib.request.urlopen(req) as res:
    print(res.read().decode())`,
  TypeScript: `const url = "${API_BASE}/v1/chat/completions";

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer ${KEY_PLACEHOLDER}",
  },
  body: JSON.stringify({
    model: "${DEFAULT_MODEL}",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Detroit LLM" }],
  }),
});

console.log(await res.json());`,
  Go: `package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func main() {
    body, _ := json.Marshal(map[string]any{
        "model":      "${DEFAULT_MODEL}",
        "max_tokens": 1024,
        "messages":   []map[string]string{{"role": "user", "content": "Hello, Detroit LLM"}},
    })

    req, _ := http.NewRequest("POST", "${API_BASE}/v1/chat/completions", bytes.NewBuffer(body))
    req.Header.Set("content-type", "application/json")
    req.Header.Set("authorization", "Bearer "+os.Getenv("DETROIT_API_KEY"))

    res, err := http.DefaultClient.Do(req)
    if err != nil {
        panic(err)
    }
    defer res.Body.Close()

    fmt.Println(res.Status)
}`,
  Java: `import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;

public class Main {
    public static void main(String[] args) throws Exception {
        String body = """
            {
              "model": "${DEFAULT_MODEL}",
              "max_tokens": 1024,
              "messages": [{"role": "user", "content": "Hello, Detroit LLM"}]
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("${API_BASE}/v1/chat/completions"))
                .header("content-type", "application/json")
                .header("authorization", "Bearer " + System.getenv("DETROIT_API_KEY"))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> res =
                HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(res.body());
    }
}`,
  Ruby: `require "json"
require "net/http"
require "uri"

uri = URI("${API_BASE}/v1/chat/completions")

body = {
  model: "${DEFAULT_MODEL}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Detroit LLM" }],
}

req = Net::HTTP::Post.new(uri)
req["content-type"] = "application/json"
req["authorization"] = "Bearer #{ENV.fetch("DETROIT_API_KEY")}"
req.body = JSON.generate(body)

res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
  http.request(req)
end

puts res.body`,
  PHP: `<?php

$body = [
    'model' => '${DEFAULT_MODEL}',
    'max_tokens' => 1024,
    'messages' => [
        ['role' => 'user', 'content' => 'Hello, Detroit LLM'],
    ],
];

$ch = curl_init('/v1/chat/completions');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'content-type: application/json',
    'authorization: Bearer ' . getenv('DETROIT_API_KEY'),
]);

$res = curl_exec($ch);
curl_close($ch);

echo $res;`,
  'C#': `using System.Net.Http;
using System.Text;
using System.Text.Json;

var client = new HttpClient();

var body = new StringContent(
    JsonSerializer.Serialize(new
    {
        model = "${DEFAULT_MODEL}",
        max_tokens = 1024,
        messages = new[] { new { role = "user", content = "Hello, Detroit LLM" } },
    }),
    Encoding.UTF8,
    "application/json"
);

client.DefaultRequestHeaders.Add("authorization", "Bearer " + Environment.GetEnvironmentVariable("DETROIT_API_KEY"));

var res = await client.PostAsync("${API_BASE}/v1/chat/completions", body);
Console.WriteLine(await res.Content.ReadAsStringAsync());`,
  cURL: `curl ${API_BASE}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -d '{
    "model": "${DEFAULT_MODEL}",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "reasoning": {"effort": "high"},
    "output_config": {"effort": "high"},
    "stream": false
  }'`,
};

const responsesCurl = `curl ${API_BASE}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -d '{
    "model": "deepseek-v4-flash",
    "input": "What is the weather in Bangkok?",
    "tools": [{
      "type": "function",
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"]
      }
    }],
    "reasoning": {"effort": "none"},
    "stream": false
  }'`;

function makeRenderer(highlightStrings: string[]) {
  return (props: any) => {
    const { rows, stylesheet, useInlineStyles } = props;
    const walk = (node: any): any => {
      if (!node || typeof node !== 'object') return node;
      if (node.type === 'text') return node;
      const text = (Array.isArray(node.children) ? node.children : [])
        .map((c: any) => (typeof c === 'string' ? c : c.value ?? ''))
        .join('');
      const kids = Array.isArray(node.children) ? node.children.map(walk) : node.children;
      const highlighted = highlightStrings.some((s) => s && text.includes(s));
      return {
        ...node,
        children: kids,
        properties: highlighted
          ? {
              ...(node.properties ?? {}),
              className: [...(node.properties?.className ?? []), 'hl-api-key'],
            }
          : node.properties,
      };
    };
    return rows.map((node: any, i: number) =>
      createElement({ node: walk(node), stylesheet, useInlineStyles, key: i })
    );
  };
}

export default function Docs() {
  const [activeTab, setActiveTab] = useState('cURL');
  const [copied, setCopied] = useState(false);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    api.listKeys().then((d) => {
      const keys = (d.keys || []) as Array<{ key: string; is_active: boolean }>
      const active = keys.find((k) => k.is_active) || keys[0]
      if (active?.key) setApiKey(active.key)
    }).catch(() => {})
  }, [])

  const codeText = CODE[activeTab] || CODE['cURL'];
  const displayCode = codeText.split(KEY_PLACEHOLDER).join(apiKey ?? '$DETROIT_API_KEY');
  const copyText =
    activeTab === 'cURL'
      ? (() => {
          const jsonMatch = displayCode.match(/-d\s+'(.*)'\s*$/s);
          if (jsonMatch) {
            const json = jsonMatch[1].trim().replace(/\s+/g, ' ');
            const url = (displayCode.match(/curl\s+(\S+)/) || [])[1] ?? '';
            return `curl ${url} -H "Content-Type: application/json" -H "Authorization: Bearer ${apiKey ?? '$DETROIT_API_KEY'}" -d "${json.replace(/"/g, '\\"')}"`;
          }
          return displayCode
            .split('\n')
            .map((line) => line.trim().replace(/\\$/, '').trim())
            .join(' ');
        })()
      : displayCode;

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyModel = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedModel(id);
    setTimeout(() => setCopiedModel(null), 2000);
  };

  return (
    <div className="p-8 text-zinc-100 font-sans space-y-16">
      {/* Hero */}
      <div className="flex items-center justify-center">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

        {/* Left Column: Hero Info */}
        <div className="space-y-6">
          <span className="text-sm font-medium text-zinc-500 tracking-wide">
            Detroit LLM Platform
          </span>

          <h1 className="text-5xl lg:text-6xl font-serif leading-tight font-normal text-zinc-50">
            Start building <br />
            with Detroit LLM
          </h1>

          <p className="text-zinc-400 text-lg max-w-md leading-relaxed">
            Everything you need to integrate Detroit LLM into your applications. From first API call to production.
          </p>

          {/* Search Bar */}
          {/* <div className="pt-2">
            <div className="relative max-w-xs flex items-center">
              <FiSearch className="absolute left-3.5 text-zinc-500 text-lg" />
              <Input
                type="text"
                placeholder="Search"
                className="w-full bg-zinc-900 border-zinc-700 rounded-lg py-2 pl-10 pr-10 text-sm text-zinc-200 placeholder-zinc-500 shadow-sm focus:ring-1 focus:ring-zinc-600 focus:ring-zinc-600"
              />
              <span className="absolute right-3 text-xs text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5 bg-zinc-800">
                ⌘K
              </span>
            </div>
          </div> */}
        </div>

        {/* Right Column: Code Snippet */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 shadow-sm overflow-hidden">
          {/* Code Tabs Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 pt-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-9 gap-1 bg-transparent p-0 text-zinc-500">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
                  >
                    {tab}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* Copy Button */}
            <Button
              onClick={handleCopy}
              variant="ghost"
              size="icon"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Copy code"
            >
              {copied ? <FiCheck className="text-green-500" /> : <FiCopy />}
            </Button>
          </div>

          {/* Code Window Body */}
          <div className="text-sm leading-relaxed bg-zinc-900 overflow-x-auto">
            <SyntaxHighlighter
              language={LANG[activeTab] || 'bash'}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '1.5rem',
                background: 'transparent',
                fontSize: '0.875rem',
                lineHeight: '1.625',
              }}
              codeTagProps={{ style: { fontFamily: 'inherit' } }}
              renderer={makeRenderer(apiKey ? [apiKey, DEFAULT_MODEL] : [DEFAULT_MODEL])}
            >
              {displayCode}
            </SyntaxHighlighter>
          </div>
        </div>

      </div>
      </div>

      {/* Responses API */}
      <section className="max-w-6xl w-full mx-auto">
        <h2 className="text-2xl font-serif font-normal text-zinc-50 mb-2">Responses API</h2>
        <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">
          The Responses API is our OpenAI-compatible agentic endpoint — built for tool-calling loops
          (function calling, streaming deltas, and structured outputs) used by agent harnesses such as
          the OpenAI Agents SDK and Gemini CLI. Point your harness at{' '}
          <code className="font-mono text-xs text-zinc-300">{API_BASE}/v1</code>.
        </p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
            <span className="font-mono text-xs text-zinc-400">POST /v1/responses</span>
            <Button
              onClick={() => navigator.clipboard.writeText(responsesCurl)}
              variant="ghost"
              size="sm"
              className="text-zinc-500 hover:text-zinc-300 h-7 px-2 text-xs"
            >
              <FiCopy className="mr-1" /> Copy
            </Button>
          </div>
          <div className="text-sm leading-relaxed bg-zinc-900 overflow-x-auto">
            <SyntaxHighlighter language="bash" style={vscDarkPlus} customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent', fontSize: '0.875rem', lineHeight: '1.625' }} codeTagProps={{ style: { fontFamily: 'inherit' } }}>
              {responsesCurl}
            </SyntaxHighlighter>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ['Function calling', 'Pass tools[] — the model returns function_call output items, then you feed results back via function_call_output items.'],
            ['Streaming', 'set stream:true to receive SSE events: response.created, response.output_text.delta, response.completed.'],
            ['Structured output', 'Force valid JSON with text:{"format":{"type":"json_schema","name":"...","schema":{...}}} or {"type":"json_object"}.'],
            ['Multi-turn', 'Pass the full conversation history in input[] (stateless). previous_response_id is not supported by the upstream.'],
            ['Reasoning', 'Control thinking with reasoning:{"effort":"low"|"high"|"max"|"none"}.'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="text-sm font-medium text-zinc-200 mb-1">{title}</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-500 max-w-2xl leading-relaxed">
          Note: the Chat Completions endpoint supports JSON mode via <code className="font-mono">{'{ "type": "json_object" }'}</code>,
          but schema-constrained output (<code className="font-mono">json_schema</code>) is only available on the Responses API.
          Vision requests (image_url) are routed to Gemini automatically.
        </p>
      </section>

      {/* Explanation table */}
      <section className="max-w-6xl w-full mx-auto">
        <h2 className="text-2xl font-serif font-normal text-zinc-50 mb-4">API Reference</h2>
        <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">
          A quick reference for the Chat Completions endpoint, its parameters, and response fields.
          For agentic workloads (tool calling, streaming loops) see the Responses API above.
        </p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['model', 'string', 'Yes', 'Model identifier, e.g. deepseek-v4-pro or deepseek-v4-flash.'],
                ['max_tokens', 'integer', 'No', 'Maximum tokens to generate. Defaults to 1024.'],
                ['messages', 'array<Message>', 'Yes', 'List of messages: { role, content }. Roles: system, user, assistant.'],
                ['temperature', 'number', 'No', 'Sampling temperature between 0 and 2. Defaults to 1.0.'],
                ['top_p', 'number', 'No', 'Nucleus sampling probability. Defaults to 1.0.'],
                ['stream', 'boolean', 'No', 'Stream partial deltas as they arrive. Defaults to false.'],
                ['reasoning', 'object', 'No', 'Thinking control: {"effort": "low"|"high"|"max"} to enable reasoning, or {"effort": "none"} to disable it.'],
                ['output_config', 'object', 'No', 'Output effort: {"effort": "low"|"high"|"max"}. Pairs with reasoning.'],
                ['authorization', 'header', 'Yes', 'Your secret API key: "Bearer sk-dt-..." from the API Keys page.'],
              ].map((row) => (
                <TableRow key={row[0]}>
                  <TableCell className="font-mono text-xs">{row[0]}</TableCell>
                  <TableCell className="text-zinc-400">{row[1]}</TableCell>
                  <TableCell>
                    <span className={`text-xs ${row[2] === 'Yes' ? 'text-red-400' : 'text-zinc-500'}`}>{row[2]}</span>
                  </TableCell>
                  <TableCell className="text-zinc-400">{row[3]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Models */}
      <section className="max-w-6xl w-full mx-auto">
        <h2 className="text-2xl font-serif font-normal text-zinc-50 mb-2">Models</h2>
        <p className="text-zinc-400 text-sm mb-6 max-w-2xl leading-relaxed">
          Choose the model that fits your workload.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              id: 'deepseek-v4-pro',
              tag: 'Flagship',
              desc: 'DeepSeek V4 Pro — the most capable model for complex reasoning, coding, and production workloads.',
              ctx: '1M context',
              size: '304B parameters',
              highlight: true,
            },
            {
              id: 'deepseek-v4-flash',
              tag: 'Fast',
              desc: 'DeepSeek V4 Flash — the fastest, lightweight model for everyday assistants, Q&A, and high-volume tasks.',
              ctx: '1M context',
              size: '304B parameters',
              highlight: false,
            },
          ].map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-5 transition-colors ${
                m.highlight
                  ? 'border-(--primary-color)/40 bg-(--primary-color)/10'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-sm text-zinc-100 truncate">{m.id}</code>
                  <button
                    onClick={() => handleCopyModel(m.id)}
                    className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    title="Copy model name"
                  >
                    {copiedModel === m.id ? <FiCheck className="text-green-500" /> : <FiCopy className="text-xs" />}
                  </button>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">{m.tag}</span>
              </div>
              <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{m.desc}</p>
              <div className="space-y-1.5 border-t border-zinc-800 pt-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Context</span>
                  <span className="text-zinc-300">{m.ctx}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Size</span>
                  <span className="text-zinc-300">{m.size}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
