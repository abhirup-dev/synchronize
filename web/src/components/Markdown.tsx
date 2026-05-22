// Safe markdown renderer for message bodies. GFM features (tables, task lists,
// strikethrough, autolinks) + sanitized HTML + syntax-highlighted code fences.
// Trusted-but-not-trusted: agents may quote arbitrary content; we sanitize.

import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import type { Agent } from "../data/types.ts";
import { MentionChip } from "./primitives.tsx";

// Permit GFM-specific tags + the class attributes rehype-highlight emits.
const schema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-/, /^hljs/]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^hljs/]],
    input: [
      ["type", "checkbox"],
      ["checked"],
      ["disabled"],
    ],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "del",
    "input",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
};

export function Markdown({ children, agents }: { children: string; agents?: Agent[] }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema], rehypeHighlight]}
        components={{
          code(props) {
            const { children, className } = props as { children?: React.ReactNode; className?: string };
            // Only intercept inline code (no language- className from highlight).
            const isInline = !className || !/language-/.test(className);
            if (isInline && agents) {
              const text = String(children ?? "");
              const m = text.match(/^@@(\w+)$/);
              if (m) {
                const agent = agents.find((a) => a.handle === m[1]);
                if (agent) return <MentionChip agent={agent} />;
              }
            }
            return <code className={className}>{children}</code>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
