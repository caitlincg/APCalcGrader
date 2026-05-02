"use client";

import "katex/dist/katex.min.css";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

type Props = {
  text: string;
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 border-b border-sky-500/30 pb-3 text-xl font-semibold tracking-tight text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-10 border-b border-slate-600/80 pb-2 text-lg font-semibold tracking-tight text-sky-100 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-base font-semibold text-slate-100">{children}</h3>
  ),
  p: ({ children }) => <p className="my-3 text-[15px] leading-[1.7] text-slate-300">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-[15px] text-slate-300">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[15px] text-slate-300">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-sky-500/80">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-50">{children}</strong>,
  em: ({ children }) => <em className="text-slate-200 italic">{children}</em>,
  hr: () => <hr className="my-8 border-0 border-t border-slate-700/60" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-sky-500/40 bg-slate-900/50 py-2 pl-4 pr-3 text-slate-300 [&_p]:my-2">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded-md bg-slate-800/90 px-1.5 py-0.5 font-mono text-[13px] text-sky-100"
          style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <pre
        className="my-4 overflow-x-auto rounded-xl border border-slate-700/50 bg-slate-950/90 p-4 text-[13px] text-slate-300"
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
};

/**
 * Renders model output: Markdown + $inline$ and $$block$$ math via KaTeX (readable sans body, not a monospace slab).
 */
export function FeedbackMarkdown({ text }: Props) {
  return (
    <article className="feedback-shell mt-5 overflow-hidden rounded-2xl border border-slate-700/50 bg-gradient-to-b from-slate-900/90 via-slate-950/95 to-slate-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className="border-b border-slate-700/40 bg-slate-900/50 px-5 py-3">
        <p className="text-xs font-medium uppercase tracking-widest text-sky-400/90">Scoring report</p>
        <p className="mt-0.5 text-sm text-slate-500">LaTeX math renders below; scroll wide equations horizontally.</p>
      </div>
      <div
        className="feedback-md px-5 py-6 pb-8 text-slate-200 [&_.katex]:text-slate-100 [&_.katex-display]:my-5 [&_.katex-display]:overflow-x-auto [&_.katex-display]:rounded-xl [&_.katex-display]:border [&_.katex-display]:border-slate-700/40 [&_.katex-display]:bg-slate-950/60 [&_.katex-display]:px-4 [&_.katex-display]:py-3"
        style={{ fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif" }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
          {text}
        </ReactMarkdown>
      </div>
    </article>
  );
}
