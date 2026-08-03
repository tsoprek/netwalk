import type { ReactNode } from "react";

interface Props {
  text: string;
  onOpenUrl?: (url: string) => void;
}

/** Accept the legacy `(label)[https://…]` form used in some CE-Infra notes. */
export function normalizeMarkdownLinks(value: string): string {
  return String(value || "").replace(
    /\(([^)\n]+)\)\[(https?:\/\/[^\]\s]+)\]/gi,
    "[$1]($2)",
  );
}

function safeWebUrl(value: string): string | null {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function inlineNodes(text: string, keyPrefix: string, onOpenUrl?: (url: string) => void): ReactNode[] {
  const pattern = /(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])|(https?:\/\/[^\s<]+))/gi;
  const output: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) != null) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[2] && match[3]) {
      output.push(linkNode(match[3], match[2], key, onOpenUrl));
    } else if (match[4]) {
      output.push(<code key={key}>{match[4]}</code>);
    } else if (match[5] || match[6]) {
      output.push(<strong key={key}>{match[5] || match[6]}</strong>);
    } else if (match[7] || match[8]) {
      output.push(<em key={key}>{match[7] || match[8]}</em>);
    } else if (match[9]) {
      output.push(linkNode(match[9], match[9], key, onOpenUrl));
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function linkNode(
  hrefValue: string,
  label: string,
  key: string,
  onOpenUrl?: (url: string) => void,
): ReactNode {
  const href = safeWebUrl(hrefValue);
  if (!href) return label;
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpenUrl ? (event) => {
        event.preventDefault();
        onOpenUrl(href);
      } : undefined}
    >
      {label}
    </a>
  );
}

export default function SafeMarkdown({ text, onOpenUrl }: Props) {
  const lines = normalizeMarkdownLinks(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      blocks.push(<div key={`space-${index}`} style={{ height: 6 }} />);
      index += 1;
      continue;
    }

    const fence = /^```([^`]*)$/.exec(line.trim());
    if (fence) {
      const language = fence[1].trim().replace(/[^a-z0-9_+-]/gi, "").slice(0, 32);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`} className="safe-markdown-code">
          <code className={language ? `language-${language}` : undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const match = /^>\s?(.*)$/.exec(lines[index]);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className="safe-markdown-quote">
          {quoteLines.map((part, partIndex) => (
            <span key={`quote-line-${partIndex}`}>
              {partIndex > 0 && <br />}
              {inlineNodes(part, `quote-${index}-${partIndex}`, onOpenUrl)}
            </span>
          ))}
        </blockquote>,
      );
      continue;
    }

    const unordered = /^\s*[-+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const orderedList = !!ordered;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const itemMatch = orderedList
          ? /^\s*\d+[.)]\s+(.+)$/.exec(lines[index])
          : /^\s*[-+]\s+(.+)$/.exec(lines[index]);
        if (!itemMatch) break;
        items.push(<li key={`item-${index}`}>{inlineNodes(itemMatch[1], `item-${index}`, onOpenUrl)}</li>);
        index += 1;
      }
      blocks.push(orderedList
        ? <ol key={`list-${index}`}>{items}</ol>
        : <ul key={`list-${index}`}>{items}</ul>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = inlineNodes(heading[2], `heading-${index}`, onOpenUrl);
      const style = { margin: "4px 0", fontSize: heading[1].length === 1 ? 17 : heading[1].length === 2 ? 15 : 14 };
      blocks.push(<div key={`heading-${index}`} style={style}><strong>{content}</strong></div>);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    const start = index;
    while (index < lines.length && lines[index].trim()) {
      if (index > start && (/^\s*[-+]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index]) || /^#{1,3}\s+/.test(lines[index]) || /^```/.test(lines[index]) || /^>\s?/.test(lines[index]))) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <div key={`paragraph-${start}`} style={{ margin: "2px 0" }}>
        {paragraph.map((part, partIndex) => (
          <span key={`line-${start}-${partIndex}`}>
            {partIndex > 0 && <br />}
            {inlineNodes(part, `line-${start}-${partIndex}`, onOpenUrl)}
          </span>
        ))}
      </div>,
    );
  }

  return (
    <div style={{ overflowWrap: "anywhere", textAlign: "left" }}>
      {blocks}
    </div>
  );
}
