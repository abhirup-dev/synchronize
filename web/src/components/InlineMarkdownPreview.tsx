import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { copyText } from "../utils/clipboard.ts";
import { useContextMenu } from "./ContextMenu.tsx";
import { useToast } from "./Toast.tsx";

export function InlineMarkdownPreview({ text, className = "" }: { text: string; className?: string }) {
  const openMenu = useContextMenu();
  const toast = useToast();

  return (
    <span className={`${className ? `${className} ` : ""}markdown`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        unwrapDisallowed
        allowedElements={["p", "strong", "em", "del", "a", "code", "br"]}
        components={{
          p({ children }) {
            return <>{children}</>;
          },
          a(props) {
            const { children, href, title } = props as { children?: ReactNode; href?: string; title?: string };
            const linkHref = href ?? "";
            const copyHref = absoluteHref(linkHref);
            return (
              <a
                href={linkHref}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
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
          text({ children }) {
            return <>{highlightLocalMentions(children)}</>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}

function highlightLocalMentions(children: ReactNode) {
  const parts = String(children ?? "").split(/(@(?:you|web:local-human)\b)/gi);
  return parts.map((part, index) =>
    /^@(?:you|web:local-human)$/i.test(part)
      ? <mark key={index} className="act-mention-hit">{part}</mark>
      : <span key={index}>{part}</span>
  );
}

function absoluteHref(href: string): string {
  try {
    return new URL(href, window.location.href).toString();
  } catch {
    return href;
  }
}
