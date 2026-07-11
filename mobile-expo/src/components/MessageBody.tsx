import React, { useMemo } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { shape, space, type } from '../theme/tokens';
import type { Scheme } from '../theme/tokens';

const md = MarkdownIt({ linkify: true });

// Wrap @mentions in mention: links so markdown-it carries them through — but
// never inside fenced/inline code, where @ is real syntax.
function markMentions(body: string): string {
  return body
    .split(/(```[\s\S]*?```|`[^`]+`)/g)
    .map((seg) =>
      seg.startsWith('`') ? seg : seg.replace(/(^|\s)@([\w:./-]+)/g, '$1[@$2](mention:$2)'),
    )
    .join('');
}

// ---------- link previews (Slack-style unfurls for PRs + docs) ----------

type Preview = {
  url: string;
  title: string;
  kind: 'pr' | 'issue' | 'doc';
  subtitle: string;
  status?: string;
};

const GH_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/;
const DOC_RE = /(notion\.so|docs\.google\.com|confluence|\.md($|[?#]))/;

function classify(url: string, title?: string): Preview | null {
  const gh = GH_RE.exec(url);
  if (gh) {
    const [, owner, repo, kind, num] = gh;
    const status = title && /\b(merged|open|closed|draft|approved)\b/i.exec(title)?.[0]?.toLowerCase();
    return {
      url,
      kind: kind === 'pull' ? 'pr' : 'issue',
      title: title && !title.startsWith('http') ? title.replace(/\s*\((merged|open|closed|draft|approved)\)\s*$/i, '') : `${repo} #${num}`,
      subtitle: `${owner}/${repo} #${num}`,
      status,
    };
  }
  if (DOC_RE.test(url)) {
    let host = 'doc';
    try {
      host = new URL(url).host.replace(/^www\./, '');
    } catch {}
    return {
      url,
      kind: 'doc',
      title: title && !title.startsWith('http') ? title : url.split('/').pop() ?? url,
      subtitle: host,
    };
  }
  return null;
}

export function extractPreviews(body: string): Preview[] {
  const previews: Preview[] = [];
  const seen = new Set<string>();
  let rest = body.replace(/```[\s\S]*?```|`[^`]+`/g, '');
  // markdown links first (they carry titles), then bare URLs from what's left
  rest = rest.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text: string, url: string) => {
    const p = classify(url, text);
    if (p && !seen.has(p.url)) {
      seen.add(p.url);
      previews.push(p);
    }
    return '';
  });
  for (const m of rest.match(/https?:\/\/[^\s)>\]]+/g) ?? []) {
    const p = classify(m);
    if (p && !seen.has(p.url)) {
      seen.add(p.url);
      previews.push(p);
    }
  }
  return previews;
}

const STATUS_ICON: Record<Preview['kind'], keyof typeof MaterialIcons.glyphMap> = {
  pr: 'call-merge',
  issue: 'adjust',
  doc: 'description',
};

function statusColors(status: string | undefined, t: Scheme) {
  switch (status) {
    case 'merged':
      return { bg: t.mentionContainer, fg: t.onMentionContainer };
    case 'open':
    case 'approved':
      return { bg: t.successContainer, fg: t.onSuccessContainer };
    case 'closed':
      return { bg: t.dangerContainer, fg: t.onDangerContainer };
    default:
      return { bg: t.surfaceContainerHigh, fg: t.onSurfaceVariant };
  }
}

function PreviewCard({ p }: { p: Preview }) {
  const { t } = useTheme();
  const tile =
    p.kind === 'doc'
      ? { bg: t.awaitingContainer, fg: t.awaiting }
      : { bg: t.primaryContainer, fg: t.primary };
  const chip = statusColors(p.status, t);
  return (
    <Pressable
      onPress={() => Linking.openURL(p.url).catch(() => {})}
      android_ripple={{ color: t.outlineVariant }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: shape.md,
        borderWidth: 1,
        borderColor: t.outlineVariant,
        backgroundColor: t.surfaceContainer,
      }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: tile.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <MaterialIcons name={STATUS_ICON[p.kind]} size={19} color={tile.fg} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.label, fontWeight: '600', color: t.onSurface }} numberOfLines={2}>
          {p.title}
        </Text>
        <Text style={{ ...type.micro, fontWeight: '400', color: t.onSurfaceVariant }} numberOfLines={1}>
          {p.subtitle}
        </Text>
      </View>
      {p.status && (
        <View style={{ backgroundColor: chip.bg, borderRadius: shape.full, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ ...type.micro, color: chip.fg, textTransform: 'capitalize' }}>{p.status}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------- themed markdown ----------

function mdStyles(t: Scheme) {
  return {
    body: { ...type.body, color: t.onSurface },
    paragraph: { marginTop: 0, marginBottom: 6 },
    heading1: { fontSize: 21, fontWeight: '700' as const, color: t.onSurface, marginTop: 8, marginBottom: 4 },
    heading2: { fontSize: 18, fontWeight: '700' as const, color: t.onSurface, marginTop: 8, marginBottom: 4 },
    heading3: { fontSize: 16, fontWeight: '600' as const, color: t.onSurface, marginTop: 6, marginBottom: 3 },
    heading4: { fontSize: 15, fontWeight: '600' as const, color: t.onSurface, marginTop: 6, marginBottom: 3 },
    strong: { fontWeight: '700' as const },
    link: { color: t.primary, fontWeight: '600' as const, textDecorationLine: 'none' as const },
    code_inline: {
      ...type.mono,
      color: t.onPrimaryContainer,
      backgroundColor: t.primaryContainer,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      ...type.mono,
      color: t.onSurface,
      backgroundColor: t.codeBg,
      borderRadius: shape.sm,
      borderWidth: 1,
      borderColor: t.outlineVariant,
      padding: space.md,
      marginBottom: 6,
    },
    code_block: {
      ...type.mono,
      color: t.onSurface,
      backgroundColor: t.codeBg,
      borderRadius: shape.sm,
      borderWidth: 1,
      borderColor: t.outlineVariant,
      padding: space.md,
      marginBottom: 6,
    },
    blockquote: {
      backgroundColor: t.surfaceContainer,
      borderLeftWidth: 3,
      borderLeftColor: t.primary,
      borderRadius: shape.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      marginBottom: 6,
      marginLeft: 0,
    },
    bullet_list: { marginBottom: 6 },
    ordered_list: { marginBottom: 6 },
    list_item: { flexDirection: 'row' as const, marginBottom: 3 },
    bullet_list_icon: { ...type.body, color: t.primary, fontWeight: '700' as const, marginRight: 8 },
    ordered_list_icon: { ...type.body, color: t.primary, fontWeight: '600' as const, marginRight: 8 },
    table: { borderWidth: 1, borderColor: t.outlineVariant, borderRadius: shape.xs, marginBottom: 6 },
    th: { padding: 7, fontWeight: '700' as const, color: t.onSurface },
    td: { padding: 7, borderTopWidth: 1, borderColor: t.outlineVariant, color: t.onSurface },
    hr: { backgroundColor: t.outlineVariant, height: 1, marginVertical: 8 },
  };
}

export function MessageBody({ body }: { body: string }) {
  const { t } = useTheme();
  const previews = useMemo(() => extractPreviews(body), [body]);
  const marked = useMemo(() => markMentions(body), [body]);
  const styles = useMemo(() => mdStyles(t), [t]);
  const rules = useMemo(
    () => ({
      link: (node: any, children: React.ReactNode, _parent: unknown, s: any) => {
        const href: string = node.attributes?.href ?? '';
        if (href.startsWith('mention:'))
          return (
            <Text key={node.key} style={{ color: t.mention, backgroundColor: t.mentionContainer, fontWeight: '600' }}>
              {children}
            </Text>
          );
        return (
          <Text key={node.key} style={s.link} onPress={() => Linking.openURL(href).catch(() => {})}>
            {children}
          </Text>
        );
      },
      fence: (node: any) => {
        const lang: string = node.sourceInfo?.trim() ?? '';
        return (
          <View
            key={node.key}
            style={{
              backgroundColor: t.codeBg,
              borderRadius: shape.sm,
              borderWidth: 1,
              borderColor: t.outlineVariant,
              padding: space.md,
              marginBottom: 6,
            }}>
            {lang ? <Text style={{ ...type.micro, color: t.primary, marginBottom: 4 }}>{lang}</Text> : null}
            <Text style={{ ...type.mono, color: t.onSurface }}>{node.content.replace(/\n$/, '')}</Text>
          </View>
        );
      },
    }),
    [t],
  );

  return (
    <View>
      <Markdown markdownit={md} style={styles as any} rules={rules}>
        {marked}
      </Markdown>
      {previews.length > 0 && (
        <View style={{ gap: 6, marginTop: 2 }}>
          {previews.map((p) => (
            <PreviewCard key={p.url} p={p} />
          ))}
        </View>
      )}
    </View>
  );
}
