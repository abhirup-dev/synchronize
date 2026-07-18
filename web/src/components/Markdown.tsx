// Safe markdown renderer for message bodies. GFM features (tables, task lists,
// strikethrough, autolinks) + sanitized HTML + syntax-highlighted code fences.
// Trusted-but-not-trusted: agents may quote arbitrary content; we sanitize.

import { memo } from "react";
import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import type { Agent } from "../data/types.ts";
import { MentionChip } from "./primitives.tsx";
import { useContextMenu } from "./ContextMenu.tsx";
import { useToast } from "./Toast.tsx";
import { copyText } from "../utils/clipboard.ts";
import { cn } from "../lib/cn.ts";

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

// Memoized: react-markdown parsing (remark-gfm + rehype-sanitize + highlight)
// is expensive, and the virtualized chat list re-renders MessageRow on every
// scroll frame. With a stable `children` string and `agents` reference, memo
// skips re-parsing entirely during scroll.
export const Markdown = memo(function Markdown({
  children,
  agents,
  variant = "basic",
}: {
  children: string;
  agents?: Agent[];
  variant?: "basic" | "rich";
}) {
  const openMenu = useContextMenu();
  const toast = useToast();
  return (
    <div className={cn("markdown", variant === "rich" && "rich-markdown")}>
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
              const m = text.match(/^@@([a-zA-Z0-9._-]+)$/);
              if (m) {
                const agent = agents.find((a) => a.handle.toLowerCase() === m[1]!.toLowerCase());
                if (agent) return <MentionChip agent={agent} text={`@${m[1]}`} />;
              }
            }
            return <code className={className}>{children}</code>;
          },
          a(props) {
            const { children, href, title } = props as { children?: React.ReactNode; href?: string; title?: string };
            const linkHref = href ?? "";
            const copyHref = absoluteHref(linkHref);
            return (
              <a
                href={linkHref}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                onContextMenu={(event) =>
                  openMenu(event, [
                    {
                      label: "Copy link address",
                      onSelect: async () => {
                        const copied = await copyText(copyHref);
                        toast.show(copied ? "Link copied" : "Could not copy link", { kind: copied ? "success" : "error" });
                      },
                    },
                  ])
                }
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

function absoluteHref(href: string): string {
  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return href;
  }
}
