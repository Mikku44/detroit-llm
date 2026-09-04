"use client";

import { useMemo } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import AIArtifact from "@/components/smoothui/ai-artifact";

const PREVIEWABLE = new Set(["html", "markup", "xml", "svg", "vue", "astro", "svelte"]);

function isFullDocument(code: string) {
  return /<html[\s>]/i.test(code);
}

function buildSrcDoc(code: string, language: string): string {
  const lang = language.toLowerCase();
  if (lang === "svg") {
    return `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${code}</body></html>`;
  }
  if (isFullDocument(code)) return code;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head><body>${code}</body></html>`;
}

export function isPreviewableLanguage(language: string) {
  return PREVIEWABLE.has(language.toLowerCase());
}

export default function CodeArtifact({ language, code }: { language: string; code: string }) {
  const srcDoc = useMemo(() => buildSrcDoc(code, language), [code, language]);
  const title = language.toLowerCase() === "svg" ? "svg artifact" : `index.${language === "markup" ? "html" : language}`;

  if (!isPreviewableLanguage(language) || code.length > 50000) return null;

  return (
    <div className="my-3">
      <AIArtifact
        title={title}
        copyText={code}
        defaultPane="preview"
        preview={
          <iframe
            title={title}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-modals"
            loading="lazy"
            className="h-[320px] w-full bg-white"
          />
        }
        code={
          <SyntaxHighlighter
            language={language === "markup" ? "html" : language}
            style={vscDarkPlus}
            customStyle={{ margin: 0, padding: 0, background: "transparent", fontSize: "0.8125rem", lineHeight: "1.6" }}
            codeTagProps={{ style: { fontFamily: "inherit" } }}
          >
            {code}
          </SyntaxHighlighter>
        }
      />
    </div>
  );
}
