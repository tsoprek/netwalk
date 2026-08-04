import { forwardRef, useEffect, useImperativeHandle, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { diagnosticEvent } from "../api/diagnostics";
import { normalizeConsoleText } from "../utils/consoleText";

export type VisualMarkdownCommand =
  | "bold" | "italic" | "inline-code" | "code-block"
  | "bullet-list" | "numbered-list" | "quote"
  | "align-left" | "align-center" | "align-right" | "align-justify"
  | "list-indent" | "list-outdent"
  | "paragraph" | "heading-1" | "heading-2" | "heading-3"
  | "undo" | "redo";

export interface VisualMarkdownEditorHandle {
  command: (command: VisualMarkdownCommand) => void;
  applyStyle: (style: VisualTextStyle) => void;
  selectedText: () => string;
  plainText: () => string;
  deleteSelection: () => void;
  insertText: (text: string) => void;
  insertLink: (href: string) => void;
  selectAll: () => void;
  focus: () => void;
}

export interface VisualTextStyle {
  fontFamily?: string;
  fontSize?: string;
  color?: string | null;
  backgroundColor?: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onOpenUrl?: (url: string) => void;
  onRequestLink?: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function plainTextPasteHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function inlineHtml(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(
    /(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_]))/gi,
    (match, _link, label, href, code, boldA, boldB, italicA, italicB) => {
      if (label && href) return `<a href="${escapeHtml(href)}">${label}</a>`;
      if (code) return `<code>${code}</code>`;
      if (boldA || boldB) return `<strong>${boldA || boldB}</strong>`;
      if (italicA || italicB) return `<em>${italicA || italicB}</em>`;
      return match;
    },
  );
}

const RICH_PREFIX = "<!--catwalk-rich-->";
const EXIT_LINE_ATTRIBUTE = "data-catwalk-exit-line";
const CODE_CARET_SENTINEL_ATTRIBUTE = "data-catwalk-code-caret";
const SAFE_RICH_TAGS = new Set(["div", "p", "br", "strong", "b", "em", "i", "code", "pre", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "span"]);

function sanitizeRichHtml(value: string): string {
  const template = document.createElement("template");
  template.innerHTML = value;
  const cleanNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    const content = Array.from(node.childNodes).map(cleanNode).join("");
    // Rich clipboard producers commonly add legacy wrappers such as <font>.
    // Keep their sanitized contents, never the wrapper's literal markup.
    if (!SAFE_RICH_TAGS.has(tag)) return content;
    if (tag === "br") return "<br>";
    const attrs: string[] = [];
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) attrs.push(`href="${escapeHtml(href)}"`);
    }
    if (tag === "pre") {
      const language = (node.dataset.language || "text").replace(/[^a-z0-9_+-]/gi, "");
      attrs.push(`data-language="${language}"`);
    }
    if (["div", "p", "h1", "h2", "h3", "blockquote", "li"].includes(tag)) {
      const alignment = node.style.textAlign;
      if (["left", "center", "right", "justify"].includes(alignment)) {
        attrs.push(`style="text-align:${alignment}"`);
      }
    }
    if (tag === "span") {
      const styles: string[] = [];
      const family = node.style.fontFamily.replace(/[<>"']/g, "").slice(0, 120);
      const size = /^(?:1[0-9]|2[0-8])px$/.test(node.style.fontSize) ? node.style.fontSize : "";
      const color = /^(?:#[0-9a-f]{6}|rgba?\([0-9 ,.]+\))$/i.test(node.style.color) ? node.style.color : "";
      const background = /^(?:#[0-9a-f]{6}|rgba?\([0-9 ,.]+\))$/i.test(node.style.backgroundColor) ? node.style.backgroundColor : "";
      if (family) styles.push(`font-family:${family}`);
      if (size) styles.push(`font-size:${size}`);
      if (color) styles.push(`color:${color}`);
      if (background) styles.push(`background-color:${background}`);
      if (styles.length) attrs.push(`style="${styles.join(";")}"`);
      if (node.hasAttribute("data-clear-color")) attrs.push('data-clear-color="true"');
      if (node.hasAttribute("data-clear-highlight")) attrs.push('data-clear-highlight="true"');
    }
    return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${content}</${tag}>`;
  };
  return Array.from(template.content.childNodes).map(cleanNode).join("");
}

export function markdownToEditorHtml(markdown: string): string {
  markdown = String(markdown || "");
  // Older builds escaped unsupported rich clipboard wrappers into a rich
  // note, leaving their literal <font>/<span> source visible after reload.
  // Decode only to probe for that distinctive envelope; ordinary entities in
  // intentional note content remain untouched.
  if (markdown.startsWith(RICH_PREFIX)) {
    const encoded = markdown.slice(RICH_PREFIX.length).replace(/^\s+/, "");
    const decoder = document.createElement("textarea");
    decoder.innerHTML = encoded;
    const decoded = decoder.value;
    const recovered = normalizeConsoleText(decoded);
    if (recovered !== decoded) markdown = recovered;
  }
  markdown = normalizeConsoleText(markdown);
  if (String(markdown || "").startsWith(RICH_PREFIX)) {
    return sanitizeRichHtml(String(markdown).slice(RICH_PREFIX.length).replace(/^\s+/, ""));
  }
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = /^```([^`]*)$/.exec(line.trim());
    if (fence) {
      const language = fence[1].trim().replace(/[^a-z0-9_+-]/gi, "").slice(0, 32);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      while (code.length > 0 && !code[code.length - 1].length) code.pop();
      blocks.push(`<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(`<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`); index += 1; continue; }
    if (/^>\s?/.test(line)) {
      const parts: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) parts.push(inlineHtml(lines[index++].replace(/^>\s?/, "")));
      blocks.push(`<blockquote>${parts.join("<br>")}</blockquote>`); continue;
    }
    const unordered = /^\s*[-+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+]\s+(.+)$/;
      while (index < lines.length) {
        const match = pattern.exec(lines[index]);
        if (!match) break;
        items.push(`<li>${inlineHtml(match[1])}</li>`); index += 1;
      }
      blocks.push(`<${tag}>${items.join("")}</${tag}>`); continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^```|^#{1,3}\s+|^>\s?|^\s*[-+]\s+|^\s*\d+[.)]\s+/.test(lines[index])) {
      paragraph.push(inlineHtml(lines[index++]));
    }
    // Incomplete Markdown markers such as "- ", "1. ", or "# " are not
    // valid blocks, but they still match the block-start lookahead above.
    // Always consume one line when no block parser accepted it; otherwise the
    // outer loop would remain on the same line and freeze the renderer.
    if (paragraph.length === 0) paragraph.push(inlineHtml(lines[index++]));
    blocks.push(`<div>${paragraph.join("<br>")}</div>`);
  }
  return blocks.join("");
}

function nodeMarkdown(node: Node, inPre = false): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeConsoleText((node.textContent || "").replace(/\u00a0/g, " "));
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  if (node.hasAttribute(EXIT_LINE_ATTRIBUTE)) return "";
  const children = () => Array.from(node.childNodes).map((child) => nodeMarkdown(child, inPre)).join("");
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${children()}**`;
  if (tag === "em" || tag === "i") return `*${children()}*`;
  if (tag === "code") return inPre ? (node.textContent || "") : `\`${children()}\``;
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    return /^https?:\/\//i.test(href) ? `[${children()}](${href})` : children();
  }
  if (/^h[1-3]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
  if (tag === "pre") {
    const language = (node.dataset.language || "text").replace(/[^a-z0-9_+-]/gi, "");
    const content = normalizeConsoleText(node.textContent || "").replace(/\n+$/g, "");
    if (!content.trim()) return "";
    return `\`\`\`${language}\n${content}\n\`\`\`\n\n`;
  }
  if (tag === "blockquote") return `${children().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li");
    return `${items.map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${nodeMarkdown(item).trim()}`).join("\n")}\n\n`;
  }
  if (tag === "li") return children();
  if (tag === "div" || tag === "p") return `${children()}\n\n`;
  return children();
}

export function editorElementToMarkdown(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`[${EXIT_LINE_ATTRIBUTE}], [${CODE_CARET_SENTINEL_ATTRIBUTE}]`).forEach((line) => line.remove());
  if (clone.querySelector(
    "span[style], span[data-clear-color], span[data-clear-highlight], [style*='text-align'], ul ul, ul ol, ol ul, ol ol",
  )) {
    return `${RICH_PREFIX}\n${sanitizeRichHtml(clone.innerHTML)}`;
  }
  return Array.from(clone.childNodes).map((node) => nodeMarkdown(node)).join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Rendered plain text of the editor with block boundaries preserved as line
 * breaks and no Markdown syntax. Suitable for sending note content to a
 * terminal (each visual line becomes one line of input).
 */
export function editorElementToPlainText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node) => !(node instanceof HTMLElement && node.hasAttribute(EXIT_LINE_ATTRIBUTE)))
    .map((node) => logicalText(node))
    .join("\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function selectionElement(range: Range): HTMLElement | null {
  const node = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  return node instanceof HTMLElement ? node : null;
}

function caretIsAtEndOf(range: Range, element: HTMLElement): boolean {
  if (!range.collapsed || !element.contains(range.startContainer)) return false;
  const remainder = document.createRange();
  remainder.selectNodeContents(element);
  remainder.setStart(range.startContainer, range.startOffset);
  return remainder.toString() === "";
}

function caretIsAtStartOf(range: Range, element: HTMLElement): boolean {
  if (!range.collapsed || !element.contains(range.startContainer)) return false;
  const prefix = document.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString() === "";
}

function moveCaret(selection: Selection, container: Node, offset: number) {
  const next = document.createRange();
  next.setStart(container, offset);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
}

function textOffsetWithin(element: HTMLElement, range: Range): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function moveCaretToTextOffset(element: HTMLElement, selection: Selection, targetOffset: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, targetOffset);
  let lastText: Text | null = null;
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    lastText = text;
    const length = text.data.length;
    if (remaining <= length) {
      moveCaret(selection, text, remaining);
      return;
    }
    remaining -= length;
  }
  if (lastText) moveCaret(selection, lastText, lastText.data.length);
  else moveCaret(selection, element, 0);
}

function logicalText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node instanceof HTMLElement && node.hasAttribute(CODE_CARET_SENTINEL_ATTRIBUTE)) return "";
  if (node instanceof HTMLBRElement) return "\n";
  return Array.from(node.childNodes).map(logicalText).join("");
}

function logicalOffsetWithin(element: HTMLElement, range: Range): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  return logicalText(prefix.cloneContents()).length;
}

function moveCaretToLogicalOffset(element: HTMLElement, selection: Selection, targetOffset: number) {
  let consumed = 0;
  const target = Math.max(0, targetOffset);
  let fallback: { container: Node; offset: number } = { container: element, offset: 0 };

  const visit = (parent: Node): { container: Node; offset: number } | null => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (target <= consumed + length) return { container: child, offset: target - consumed };
        consumed += length;
        fallback = { container: child, offset: length };
      } else if (child instanceof HTMLBRElement) {
        if (target <= consumed) return { container: parent, offset: index };
        consumed += 1;
        fallback = { container: parent, offset: index + 1 };
        if (target <= consumed) return fallback;
      } else {
        const found = visit(child);
        if (found) return found;
        fallback = { container: parent, offset: index + 1 };
      }
    }
    return null;
  };

  const point = visit(element) ?? fallback;
  moveCaret(selection, point.container, point.offset);
}

/** Moves Home/End to the current line boundary while editing code. */
export function moveCodeCaretToLineBoundary(
  editor: HTMLElement,
  selection: Selection,
  key: "Home" | "End",
): boolean {
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  if (!element || !editor.contains(element)) return false;
  const code = element.closest("code");
  if (!(code instanceof HTMLElement) || !code.contains(range.startContainer)) return false;

  const content = code.textContent || "";
  const offset = textOffsetWithin(code, range);
  const target = key === "Home"
    ? content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1
    : (() => {
      const lineEnd = content.indexOf("\n", offset);
      return lineEnd < 0 ? content.length : lineEnd;
    })();
  moveCaretToTextOffset(code, selection, target);
  return true;
}

/** Moves Home/End to the current visual-editor line outside code formatting. */
export function moveEditorCaretToLineBoundary(
  editor: HTMLElement,
  selection: Selection,
  key: "Home" | "End",
): boolean {
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  if (!element || !editor.contains(element) || element.closest("code")) return false;
  const block = element.closest("div, p, h1, h2, h3, blockquote, li");
  if (!(block instanceof HTMLElement) || !editor.contains(block)) return false;

  const content = logicalText(block);
  const offset = logicalOffsetWithin(block, range);
  const target = key === "Home"
    ? content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1
    : (() => {
      const lineEnd = content.indexOf("\n", offset);
      return lineEnd < 0 ? content.length : lineEnd;
    })();
  moveCaretToLogicalOffset(block, selection, target);
  return true;
}

/**
 * True when only trailing spaces/tabs (or nothing) remain between the caret and
 * the end of a code block. With `white-space: pre-wrap`, WebKit will not let the
 * caret move past a trailing space at the very end of the block, so a plain
 * end-of-content check never matches and the user cannot arrow out. Treat a
 * whitespace-only remainder on the last line as the end for exit purposes.
 */
function caretIsAtCodeBlockEnd(range: Range, pre: HTMLElement): boolean {
  if (!range.collapsed || !pre.contains(range.startContainer)) return false;
  const remainder = document.createRange();
  remainder.selectNodeContents(pre);
  remainder.setStart(range.startContainer, range.startOffset);
  return /^[^\S\n]*$/.test(remainder.toString());
}

/**
 * Moves a collapsed caret out of code formatting when it is at the end of an
 * inline code span or code block. Contenteditable otherwise tends to keep new
 * input inside the code element (and WebKit may display a placeholder box).
 */
export function exitCodeFormattingAtEnd(editor: HTMLElement, selection: Selection): "inline" | "block" | null {
  if (!selection.rangeCount || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  if (!element || !editor.contains(element)) return null;

  const pre = element.closest("pre");
  if (pre instanceof HTMLPreElement && caretIsAtCodeBlockEnd(range, pre)) {
    const following = pre.nextSibling;
    if (following instanceof HTMLElement && following.tagName.toLowerCase() !== "pre") {
      const next = document.createRange();
      next.selectNodeContents(following);
      next.collapse(true);
      selection.removeAllRanges();
      selection.addRange(next);
    } else {
      const parent = pre.parentNode;
      if (!parent) return null;
      const offset = Array.prototype.indexOf.call(parent.childNodes, pre) + 1;
      moveCaret(selection, parent, offset);
    }
    return "block";
  }

  let code = element.closest("code");
  // WebKit can canonicalize a caret at the end of an inline element as a
  // parent-container boundary rather than a point inside the <code> node.
  if (!(code instanceof HTMLElement) && range.startContainer.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
    const previous = range.startContainer.childNodes[range.startOffset - 1];
    if (previous instanceof HTMLElement && previous.tagName.toLowerCase() === "code") code = previous;
  }
  const atInlineCodeEnd = code instanceof HTMLElement
    && !code.closest("pre")
    && (caretIsAtEndOf(range, code)
      || (range.startContainer === code.parentNode
        && range.startOffset === Array.prototype.indexOf.call(code.parentNode.childNodes, code) + 1));
  if (code instanceof HTMLElement && atInlineCodeEnd) {
    const parent = code.parentNode;
    if (!parent) return null;
    const following = code.nextSibling;
    if (following?.nodeType === Node.TEXT_NODE) {
      moveCaret(selection, following, 0);
    } else {
      // WebKit treats a bare parent boundary after inline <code> as if the
      // caret were still formatted, even though Selection reports the parent.
      // A plain-text host makes the formatting boundary unambiguous. The
      // serializer normalizes this to a regular separator and trimEnd removes
      // it entirely when the user navigates away without typing.
      const plainText = document.createTextNode("\u00a0");
      parent.insertBefore(plainText, following);
      moveCaret(selection, plainText, 1);
    }
    return "inline";
  }
  return null;
}

/** Moves a caret at the start of code to the preceding block boundary without
 * creating a placeholder node. Arrow navigation must never edit the note. */
export function exitCodeFormattingAtStart(editor: HTMLElement, selection: Selection): "inline" | "block" | null {
  if (!selection.rangeCount || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  if (!element || !editor.contains(element)) return null;

  const pre = element.closest("pre");
  if (pre instanceof HTMLPreElement && caretIsAtStartOf(range, pre)) {
    const previous = pre.previousSibling;
    if (previous instanceof HTMLElement && previous.tagName.toLowerCase() !== "pre") {
      const next = document.createRange();
      next.selectNodeContents(previous);
      next.collapse(false);
      selection.removeAllRanges();
      selection.addRange(next);
    } else {
      const parent = pre.parentNode;
      if (!parent) return null;
      moveCaret(selection, parent, Array.prototype.indexOf.call(parent.childNodes, pre));
    }
    return "block";
  }

  const code = element.closest("code");
  if (code instanceof HTMLElement && !code.closest("pre") && caretIsAtStartOf(range, code)) {
    const parent = code.parentNode;
    if (!parent) return null;
    const previous = code.previousSibling;
    if (previous?.nodeType === Node.TEXT_NODE) moveCaret(selection, previous, previous.textContent?.length ?? 0);
    else moveCaret(selection, parent, Array.prototype.indexOf.call(parent.childNodes, code));
    return "inline";
  }
  return null;
}

function quoteAtSelectionBoundary(editor: HTMLElement, range: Range, direction: "before" | "after"): HTMLQuoteElement | null {
  const element = selectionElement(range);
  const closest = element?.closest("blockquote");
  if (closest instanceof HTMLQuoteElement) return closest;
  if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
  const adjacentIndex = direction === "after" ? range.startOffset - 1 : range.startOffset;
  const adjacent = range.startContainer.childNodes[adjacentIndex];
  return adjacent instanceof HTMLQuoteElement && editor.contains(adjacent) ? adjacent : null;
}

/** Moves a boundary caret into a normal paragraph before or after a quote. */
export function exitQuoteFormatting(
  editor: HTMLElement,
  selection: Selection,
  direction: "before" | "after",
): boolean {
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const quote = quoteAtSelectionBoundary(editor, range, direction);
  if (!quote) return false;
  const atBoundary = direction === "after"
    ? (caretIsAtEndOf(range, quote)
      || (range.startContainer === quote.parentNode
        && range.startOffset === Array.prototype.indexOf.call(quote.parentNode.childNodes, quote) + 1))
    : (caretIsAtStartOf(range, quote)
      || (range.startContainer === quote.parentNode
        && range.startOffset === Array.prototype.indexOf.call(quote.parentNode.childNodes, quote)));
  if (!atBoundary) return false;

  const sibling = direction === "after" ? quote.nextSibling : quote.previousSibling;
  if (sibling instanceof HTMLElement && sibling.tagName.toLowerCase() !== "blockquote") {
    const next = document.createRange();
    next.selectNodeContents(sibling);
    next.collapse(direction === "before" ? false : true);
    selection.removeAllRanges();
    selection.addRange(next);
    return true;
  }
  const parent = quote.parentNode;
  if (!parent) return false;
  const quoteOffset = Array.prototype.indexOf.call(parent.childNodes, quote);
  moveCaret(selection, parent, direction === "after" ? quoteOffset + 1 : quoteOffset);
  return true;
}

/** Keeps Enter-created lines inside one quote instead of creating sibling quotes. */
export function insertQuoteLineBreak(editor: HTMLElement, selection: Selection): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  const quote = element?.closest("blockquote");
  if (!(quote instanceof HTMLQuoteElement) || !editor.contains(quote)) return false;
  range.deleteContents();
  const lineBreak = document.createElement("br");
  range.insertNode(lineBreak);
  const next = document.createRange();
  next.setStartAfter(lineBreak);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
}

/** Keeps Enter-created lines inside one code block instead of sibling blocks. */
export function insertCodeLineBreak(editor: HTMLElement, selection: Selection): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  const code = element?.closest("pre > code");
  if (!(code instanceof HTMLElement) || !editor.contains(code)) return false;
  const atCodeEnd = caretIsAtEndOf(range, code);
  code.querySelectorAll(`[${CODE_CARET_SENTINEL_ATTRIBUTE}]`).forEach((sentinel) => sentinel.remove());
  range.deleteContents();
  if (code.childNodes.length === 1 && code.firstChild instanceof HTMLBRElement) {
    code.firstChild.remove();
    range.selectNodeContents(code);
    range.collapse(true);
  }
  const lineBreak = document.createTextNode("\n");
  range.insertNode(lineBreak);
  if (atCodeEnd) {
    // WebKit does not paint a caret row after a single trailing text newline.
    // A BR sentinel makes that row visible, but is excluded from Markdown and
    // plain-text serialization and removed as soon as real input arrives.
    const sentinel = document.createElement("br");
    sentinel.setAttribute(CODE_CARET_SENTINEL_ATTRIBUTE, "true");
    lineBreak.after(sentinel);
    moveCaret(selection, sentinel.parentNode!, Array.prototype.indexOf.call(sentinel.parentNode!.childNodes, sentinel));
  } else {
    moveCaret(selection, lineBreak, 1);
  }
  return true;
}

function removeCodeCaretSentinelAtSelection(editor: HTMLElement, selection: Selection | null) {
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const code = selectionElement(range)?.closest("pre > code");
  if (!(code instanceof HTMLElement) || !editor.contains(code)) return;
  code.querySelectorAll(`[${CODE_CARET_SENTINEL_ATTRIBUTE}]`).forEach((sentinel) => sentinel.remove());
}

/** Inserts clipboard text into one code element without letting WebKit split
 * newline-containing text into sibling or empty PRE blocks. */
export function insertTextIntoCodeBlock(
  editor: HTMLElement,
  selection: Selection,
  value: string,
): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  const code = element?.closest("pre > code");
  if (!(code instanceof HTMLElement) || !editor.contains(code) || !code.contains(range.endContainer)) return false;
  code.querySelectorAll(`[${CODE_CARET_SENTINEL_ATTRIBUTE}]`).forEach((sentinel) => sentinel.remove());
  range.deleteContents();
  if (code.childNodes.length === 1 && code.firstChild instanceof HTMLBRElement) {
    code.firstChild.remove();
    range.selectNodeContents(code);
    range.collapse(true);
  }
  const inserted = document.createTextNode(normalizeConsoleText(value).replace(/\r\n?/g, "\n"));
  range.insertNode(inserted);
  moveCaret(selection, inserted, inserted.data.length);
  return true;
}

function selectElementContents(element: HTMLElement, selection: Selection) {
  const next = document.createRange();
  next.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(next);
}

function unwrapElement(element: HTMLElement, selection: Selection) {
  const parent = element.parentNode;
  if (!parent) return;
  const first = element.firstChild;
  const last = element.lastChild;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
  if (!first || !last) return;
  const next = document.createRange();
  next.setStartBefore(first);
  next.setEndAfter(last);
  selection.removeAllRanges();
  selection.addRange(next);
}

export function removeEmptyInlineCode(editor: HTMLElement) {
  const selection = window.getSelection();
  const selector = "code, span[style], span[data-clear-color], span[data-clear-highlight]";
  // Deepest first: removing an empty child can make its styled parent empty.
  Array.from(editor.querySelectorAll<HTMLElement>(selector)).reverse().forEach((inline) => {
    if ((inline.tagName.toLowerCase() === "code" && inline.closest("pre"))
      || logicalText(inline).replace(/\u00a0/g, " ").trim().length) return;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const containsCaret = Boolean(range && (inline === range.startContainer || inline.contains(range.startContainer)));
    const parent = inline.parentNode;
    const offset = parent ? Array.prototype.indexOf.call(parent.childNodes, inline) : -1;
    inline.remove();
    if (containsCaret && parent && offset >= 0) moveCaret(selection!, parent, Math.min(offset, parent.childNodes.length));
  });
}

export function removeEmptyCodeBlocks(editor: HTMLElement) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  editor.querySelectorAll("pre").forEach((pre) => {
    if (normalizeConsoleText(pre.textContent || "").trim()) return;
    if (range && (range.startContainer === pre || pre.contains(range.startContainer))) return;
    pre.remove();
  });
}

function insertInlineCode(editor: HTMLElement, range: Range, selection: Selection): HTMLElement | null {
  const fragment = range.cloneContents();
  if (!logicalText(fragment).replace(/\u00a0/g, " ").length) return null;
  fragment.querySelectorAll("code").forEach((nested) => nested.replaceWith(...Array.from(nested.childNodes)));
  const wrapper = document.createElement("code");
  wrapper.appendChild(fragment);

  // execCommand participates in the native contenteditable undo transaction
  // in WebKit/WebView2. Keep a Range fallback for jsdom and older engines.
  const marker = `catwalk-code-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  wrapper.dataset.catwalkCodeMarker = marker;
  selection.removeAllRanges();
  selection.addRange(range);
  let inserted = false;
  try {
    inserted = typeof document.execCommand === "function"
      && document.execCommand("insertHTML", false, wrapper.outerHTML);
  } catch { /* use Range fallback */ }
  if (!inserted) {
    const contents = range.extractContents();
    contents.querySelectorAll("code").forEach((nested) => nested.replaceWith(...Array.from(nested.childNodes)));
    wrapper.replaceChildren(contents);
    range.insertNode(wrapper);
  }
  const result = editor.querySelector<HTMLElement>(`code[data-catwalk-code-marker="${marker}"]`) ?? wrapper;
  result.removeAttribute("data-catwalk-code-marker");
  return result.isConnected ? result : null;
}

export function toggleInlineCode(editor?: HTMLElement | null) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const current = selectionElement(range)?.closest("code");
  if (current instanceof HTMLElement && !current.closest("pre") && current.contains(range.endContainer)) {
    let outer = current;
    while (outer.parentElement?.tagName.toLowerCase() === "code") outer = outer.parentElement;
    outer.querySelectorAll("code").forEach((nested) => unwrapElement(nested, selection));
    unwrapElement(outer, selection);
    return;
  }
  if (range.collapsed) return;
  const root = editor ?? (selectionElement(range)?.closest("[contenteditable=true]") as HTMLElement | null);
  if (!root) return;

  // Triple-click selects the paragraph terminator and places the range end at
  // the beginning of the next block. Wrapping that cross-block range in one
  // inline <code> is invalid HTML; WebKit repairs it into visible empty code
  // chips on both boundaries. Format each non-empty block intersection only.
  const blockSelector = "div, p, h1, h2, h3, li, blockquote";
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(blockSelector))
    .filter((block) => {
      try { return range.intersectsNode(block); } catch { return false; }
    })
    .filter((block) => !Array.from(block.querySelectorAll<HTMLElement>(blockSelector)).some((child) => {
      try { return range.intersectsNode(child); } catch { return false; }
    }));

  if (blocks.length === 0) {
    const wrapper = insertInlineCode(root, range.cloneRange(), selection);
    if (wrapper) selectElementContents(wrapper, selection);
    removeEmptyInlineCode(root);
    return;
  }

  const intersections = blocks.flatMap((block) => {
    const part = document.createRange();
    part.selectNodeContents(block);
    if (block.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (block.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    return logicalText(part.cloneContents()).replace(/\u00a0/g, " ").length ? [part] : [];
  });
  const inserted: HTMLElement[] = [];
  for (const part of intersections.reverse()) {
    const wrapper = insertInlineCode(root, part, selection);
    if (wrapper) inserted.push(wrapper);
  }
  removeEmptyInlineCode(root);
  const ordered = inserted.filter((item) => item.isConnected).sort((left, right) => (
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  ));
  if (ordered.length === 1) {
    selectElementContents(ordered[0], selection);
  } else if (ordered.length > 1) {
    const selected = document.createRange();
    selected.setStartBefore(ordered[0]);
    selected.setEndAfter(ordered[ordered.length - 1]);
    selection.removeAllRanges();
    selection.addRange(selected);
  }
}

function trimFragmentBoundaryBreak(fragment: DocumentFragment, edge: "start" | "end") {
  let child = edge === "start" ? fragment.firstChild : fragment.lastChild;
  while (child?.nodeType === Node.TEXT_NODE && !child.textContent) {
    const next = edge === "start" ? child.nextSibling : child.previousSibling;
    child.remove();
    child = next;
  }
  if (child instanceof HTMLBRElement) child.remove();
}

function appendFragmentBlock(reference: HTMLElement, fragment: DocumentFragment, before: Node) {
  if (!logicalText(fragment).length) return;
  const block = reference.cloneNode(false) as HTMLElement;
  block.appendChild(fragment);
  reference.parentNode?.insertBefore(block, before);
}

export function toggleCodeBlock(editor: HTMLElement | null) {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return;
  let range = selection.getRangeAt(0);
  const element = selectionElement(range);
  // A Range whose original nodes were replaced remains live and WebKit may
  // retarget it to the contenteditable root. Never format that root (or a
  // selection outside it): replacing it breaks React's DOM ownership and the
  // next render fails with NotFoundError in removeChild.
  if (!element || (element !== editor && !editor.contains(element))) return;
  const current = element?.closest("pre");
  if (current instanceof HTMLPreElement && editor.contains(current) && current.contains(range.endContainer)) {
    const normal = document.createElement("div");
    const content = current.children.length === 1 && current.firstElementChild?.tagName.toLowerCase() === "code"
      ? current.firstElementChild.innerHTML
      : current.innerHTML;
    normal.innerHTML = content.replace(/\n/g, "<br>");
    current.replaceWith(normal);
    selectElementContents(normal, selection);
    return;
  }

  let candidate = element.closest("div, p, h1, h2, h3, blockquote, li");
  if (candidate === editor) {
    // A non-collapsed selection whose common block is the contenteditable root
    // means the text sits directly in the editor with no block wrapper (for
    // example a freshly typed note). Wrap just the selected span in a code
    // block and keep the surrounding text as its own lines.
    if (!range.collapsed) {
      const selected = range.cloneContents();
      // A selection that spans existing block elements (including the whole
      // editor via a stale WebKit root selection) must never be collapsed into
      // one code block: that mangles content and risks replacing React-owned
      // nodes. Only the simple "bare inline text in the root" case is wrapped.
      if (selected.querySelector("div, p, pre, h1, h2, h3, ul, ol, blockquote, li")) return;
      const rootCode = document.createElement("code");
      rootCode.textContent = logicalText(selected);
      const rootWrapper = document.createElement("pre");
      rootWrapper.dataset.language = "text";
      rootWrapper.appendChild(rootCode);

      const beforeRange = document.createRange();
      beforeRange.setStart(editor, 0);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const before = beforeRange.cloneContents();
      trimFragmentBoundaryBreak(before, "end");

      const afterRange = document.createRange();
      afterRange.setStart(range.endContainer, range.endOffset);
      afterRange.setEnd(editor, editor.childNodes.length);
      const after = afterRange.cloneContents();
      trimFragmentBoundaryBreak(after, "start");

      const isBlock = (node: Node) => node instanceof HTMLElement
        && /^(?:div|p|pre|h[1-3]|ul|ol|blockquote|li)$/.test(node.tagName.toLowerCase());
      const appendRootRun = (fragment: DocumentFragment) => {
        if (!logicalText(fragment).length) return;
        if (Array.from(fragment.childNodes).some(isBlock)) { editor.appendChild(fragment); return; }
        const line = document.createElement("div");
        line.appendChild(fragment);
        editor.appendChild(line);
      };

      const wipe = document.createRange();
      wipe.selectNodeContents(editor);
      wipe.deleteContents();
      appendRootRun(before);
      editor.appendChild(rootWrapper);
      appendRootRun(after);
      selectElementContents(rootWrapper, selection);
      return;
    }
    // WebKit represents the caret in an empty editor (and sometimes at the
    // first block boundary) as a collapsed Range on the contenteditable root.
    // Permit that precise case without reopening the stale-selection crash.
    const offset = range.startContainer === editor ? range.startOffset : 0;
    const adjacent = range.startContainer === editor
      ? (editor.childNodes[offset] ?? editor.childNodes[Math.max(0, offset - 1)])
      : range.startContainer;
    if (adjacent?.nodeType === Node.TEXT_NODE && adjacent.parentNode === editor) {
      const line = document.createElement("div");
      const text = adjacent as Text;
      const caretOffset = range.startContainer === text ? range.startOffset : 0;
      line.appendChild(document.createTextNode(text.data));
      text.replaceWith(line);
      moveCaret(selection, line.firstChild!, Math.min(caretOffset, line.textContent?.length ?? 0));
      candidate = line;
    } else if (adjacent instanceof HTMLElement && adjacent.parentNode === editor
      && adjacent.matches("div, p, h1, h2, h3, blockquote, li")) {
      candidate = adjacent;
    } else if (!editor.firstChild) {
      const line = document.createElement("div");
      line.appendChild(document.createElement("br"));
      editor.appendChild(line);
      moveCaret(selection, line, 0);
      candidate = line;
    } else return;
    range = selection.getRangeAt(0);
  }
  if (!(candidate instanceof HTMLElement) || candidate === editor || !editor.contains(candidate)) return;
  const block = candidate;
  const wrapper = document.createElement("pre");
  wrapper.dataset.language = "text";
  const code = document.createElement("code");
  if (block instanceof HTMLElement && block.contains(range.endContainer)) {
    if (!range.collapsed) {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const before = beforeRange.cloneContents();
      trimFragmentBoundaryBreak(before, "end");

      const afterRange = document.createRange();
      afterRange.selectNodeContents(block);
      afterRange.setStart(range.endContainer, range.endOffset);
      const after = afterRange.cloneContents();
      trimFragmentBoundaryBreak(after, "start");

      code.textContent = logicalText(range.cloneContents());
      wrapper.appendChild(code);
      const parent = block.parentNode;
      if (!parent) return;
      appendFragmentBlock(block, before, block);
      parent.insertBefore(wrapper, block);
      appendFragmentBlock(block, after, block);
      block.remove();
    } else {
      const caretOffset = textOffsetWithin(block, range);
      while (block.firstChild) code.appendChild(block.firstChild);
      wrapper.appendChild(code);
      block.replaceWith(wrapper);
      moveCaretToTextOffset(code, selection, caretOffset);
      return;
    }
  } else {
    code.appendChild(range.extractContents());
    wrapper.appendChild(code);
    range.insertNode(wrapper);
  }
  selectElementContents(wrapper, selection);
}

function quoteIntersectingRange(editor: HTMLElement, range: Range): HTMLQuoteElement | null {
  for (const quote of Array.from(editor.querySelectorAll("blockquote"))) {
    try {
      if (range.intersectsNode(quote)) return quote as HTMLQuoteElement;
    } catch {
      // Ignore a block that was detached while the selection was changing.
    }
  }
  return null;
}

function toggleQuote(editor: HTMLElement | null) {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const element = selectionElement(range);
  const closest = element?.closest("blockquote");
  const current = closest instanceof HTMLQuoteElement ? closest : quoteIntersectingRange(editor, range);
  if (current) {
    const normal = document.createElement("div");
    while (current.firstChild) normal.appendChild(current.firstChild);
    current.replaceWith(normal);
    selectElementContents(normal, selection);
    return;
  }

  const block = element?.closest("div, p, h1, h2, h3");
  const quote = document.createElement("blockquote");
  if (block instanceof HTMLElement && block.contains(range.endContainer)) {
    while (block.firstChild) quote.appendChild(block.firstChild);
    block.replaceWith(quote);
  } else {
    quote.appendChild(range.extractContents());
    range.insertNode(quote);
  }
  // Defensive cleanup for content pasted from other rich-text editors.
  quote.querySelectorAll("blockquote").forEach((nested) => {
    while (nested.firstChild) nested.parentNode?.insertBefore(nested.firstChild, nested);
    nested.remove();
  });
  selectElementContents(quote, selection);
}

function styleSelection(style: VisualTextStyle): Range | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const span = document.createElement("span");
  const fragment = range.extractContents();
  const clearColor = style.color === null;
  const clearHighlight = style.backgroundColor === null;
  if (clearColor) span.dataset.clearColor = "true";
  else if (style.color) span.style.color = style.color;
  if (clearHighlight) span.dataset.clearHighlight = "true";
  else if (style.backgroundColor) span.style.backgroundColor = style.backgroundColor;
  if (style.fontFamily) span.style.fontFamily = style.fontFamily;
  if (style.fontSize) span.style.fontSize = style.fontSize;
  if (style.color !== undefined || style.backgroundColor !== undefined) {
    fragment.querySelectorAll<HTMLElement>("span").forEach((child) => {
      if (style.color !== undefined) child.removeAttribute("data-clear-color");
      if (style.backgroundColor !== undefined) child.removeAttribute("data-clear-highlight");
      if (clearColor) child.style.removeProperty("color");
      if (clearHighlight) child.style.removeProperty("background-color");
      if (!child.getAttribute("style")) child.removeAttribute("style");
    });
  }
  span.appendChild(fragment);
  range.insertNode(span);
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  selection.addRange(next);
  return next;
}

/**
 * Removes placeholder lines produced by older editor builds. Navigation now
 * places the Range at the parent block boundary and never mutates the note.
 */
export function ensureExitLine(editor: HTMLElement) {
  const selection = window.getSelection();
  editor.querySelectorAll<HTMLElement>(`[${EXIT_LINE_ATTRIBUTE}]`).forEach((line) => {
    if (logicalText(line).replace(/\n/g, "").length) {
      line.removeAttribute(EXIT_LINE_ATTRIBUTE);
      return;
    }
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const containsCaret = Boolean(range && (range.startContainer === line || line.contains(range.startContainer)));
    const parent = line.parentNode;
    const offset = parent ? Array.prototype.indexOf.call(parent.childNodes, line) : -1;
    line.remove();
    if (containsCaret && parent && offset >= 0) moveCaret(selection!, parent, Math.min(offset, parent.childNodes.length));
  });
}

/**
 * Content-free structural snapshot used by Notes editor diagnostics. Keep this
 * deliberately limited to counts, element names, selection state, and lengths:
 * notes and clipboard data may contain credentials or other sensitive text.
 */
export function notesEditorDiagnosticSnapshot(editor: HTMLElement): Record<string, unknown> {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const element = range ? selectionElement(range) : null;
  const selectionInside = Boolean(element && (element === editor || editor.contains(element)));
  const codeBlocks = Array.from(editor.querySelectorAll("pre"));
  const caretCode = selectionInside ? element?.closest("code") : null;
  return {
    root_child_count: editor.childNodes.length,
    root_block_types: Array.from(editor.children).map((child) => child.tagName.toLowerCase()).join(","),
    paragraph_count: editor.querySelectorAll("div, p").length,
    code_block_count: codeBlocks.length,
    empty_code_block_count: codeBlocks.filter((pre) => !normalizeConsoleText(pre.textContent || "").trim()).length,
    inline_code_count: Array.from(editor.querySelectorAll("code")).filter((code) => !code.closest("pre")).length,
    quote_count: editor.querySelectorAll("blockquote").length,
    exit_line_count: editor.querySelectorAll(`[${EXIT_LINE_ATTRIBUTE}]`).length,
    editor_text_length: normalizeConsoleText(editor.textContent || "").length,
    selection_inside_editor: selectionInside,
    selection_collapsed: selectionInside ? Boolean(selection?.isCollapsed) : false,
    caret_container_type: selectionInside
      ? (range!.startContainer.nodeType === Node.TEXT_NODE ? "text" : (element?.tagName.toLowerCase() || "element"))
      : "outside",
    caret_offset: selectionInside ? range!.startOffset : -1,
    caret_in_code_block: Boolean(selectionInside && element?.closest("pre")),
    caret_in_inline_code: Boolean(caretCode && !caretCode.closest("pre")),
    caret_in_quote: Boolean(selectionInside && element?.closest("blockquote")),
    virtual_boundary: editor.dataset.catwalkVirtualBoundary || "none",
  };
}

type VirtualBlockBoundary = {
  block: HTMLElement;
  side: "before" | "after";
};

const VisualMarkdownEditor = forwardRef<VisualMarkdownEditorHandle, Props>(function VisualMarkdownEditor(
  { value, onChange, readOnly = false, onOpenUrl, onRequestLink }, ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const virtualBoundaryRef = useRef<VirtualBlockBoundary | null>(null);
  const diagnosticIdRef = useRef(`notes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const logDiagnostic = (message: string, fields: Record<string, unknown> = {}) => {
    const editor = editorRef.current;
    diagnosticEvent("core_ui", "debug", "conncat.notes-editor", message, {
      editor_id: diagnosticIdRef.current,
      ...(editor ? notesEditorDiagnosticSnapshot(editor) : {}),
      ...fields,
    });
  };
  const clearVirtualBoundary = () => {
    virtualBoundaryRef.current = null;
    const editor = editorRef.current;
    if (!editor) return;
    delete editor.dataset.catwalkVirtualBoundary;
    editor.style.removeProperty("--notebooks-virtual-caret-x");
    editor.style.removeProperty("--notebooks-virtual-caret-y");
  };
  const activateVirtualBoundary = (block: HTMLElement, side: "before" | "after") => {
    const editor = editorRef.current;
    if (!editor || !editor.contains(block)) return;
    virtualBoundaryRef.current = { block, side };
    editor.dataset.catwalkVirtualBoundary = side;
    const editorRect = editor.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    editor.style.setProperty("--notebooks-virtual-caret-x", `${Math.max(0, blockRect.left - editorRect.left + editor.scrollLeft + 12)}px`);
    editor.style.setProperty("--notebooks-virtual-caret-y", `${Math.max(0, (side === "after" ? blockRect.bottom + 3 : blockRect.top - 20) - editorRect.top + editor.scrollTop)}px`);
    logDiagnostic("Virtual block boundary activated", { side, block_type: block.tagName.toLowerCase() });
  };
  const restoreVirtualBoundaryRange = (boundary: VirtualBlockBoundary) => {
    const editor = editorRef.current;
    const parent = boundary.block.parentNode;
    const selection = window.getSelection();
    if (!editor || !parent || !selection || !editor.contains(boundary.block)) return false;
    const index = Array.prototype.indexOf.call(parent.childNodes, boundary.block);
    moveCaret(selection, parent, boundary.side === "after" ? index + 1 : index);
    return true;
  };
  const materializeVirtualBoundary = (): HTMLDivElement | null => {
    const boundary = virtualBoundaryRef.current;
    if (!boundary?.block.isConnected) { clearVirtualBoundary(); return null; }
    const line = document.createElement("div");
    line.appendChild(document.createElement("br"));
    boundary.block.parentNode?.insertBefore(line, boundary.side === "after" ? boundary.block.nextSibling : boundary.block);
    clearVirtualBoundary();
    const selection = window.getSelection();
    if (selection) moveCaret(selection, line, 0);
    return line;
  };
  const moveFromVirtualBoundaryIntoBlock = (boundary: VirtualBlockBoundary) => {
    const selection = window.getSelection();
    if (!selection) return;
    const target = boundary.block.matches("pre")
      ? boundary.block.querySelector<HTMLElement>("code") ?? boundary.block
      : boundary.block;
    if (boundary.side === "after") moveCaretToTextOffset(target, selection, target.textContent?.length ?? 0);
    else moveCaretToTextOffset(target, selection, 0);
    clearVirtualBoundary();
  };
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.contains(document.activeElement)) return;
    if (value === lastEmittedRef.current) return;
    clearVirtualBoundary();
    const html = markdownToEditorHtml(value);
    if (editor.innerHTML !== html) editor.innerHTML = html;
    removeEmptyInlineCode(editor);
    removeEmptyCodeBlocks(editor);
    ensureExitLine(editor);
    logDiagnostic("Editor hydrated", { stored_value_length: value.length });
  }, [value]);

  useEffect(() => {
    const remember = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount || virtualBoundaryRef.current) return;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as Element;
      if (container && editor.contains(container)) savedRangeRef.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  const restoreRange = () => {
    const range = savedRangeRef.current;
    if (!range || !range.startContainer.isConnected || !range.endContainer.isConnected) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const focusAndRestoreRange = () => {
    const selection = window.getSelection();
    const activeRange = savedRangeRef.current?.cloneRange()
      ?? (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null);
    editorRef.current?.focus();
    if (!activeRange || !activeRange.startContainer.isConnected || !activeRange.endContainer.isConnected) return;
    selection?.removeAllRanges();
    selection?.addRange(activeRange);
  };

  const emit = (reason = "native-input") => {
    const editor = editorRef.current;
    if (editor) {
      editor.querySelectorAll<HTMLElement>(`[${CODE_CARET_SENTINEL_ATTRIBUTE}]`).forEach((sentinel) => {
        const code = sentinel.closest("code");
        if (!code?.textContent?.endsWith("\n")) sentinel.remove();
      });
      removeEmptyInlineCode(editor);
      removeEmptyCodeBlocks(editor);
      const selection = window.getSelection();
      const activeRange = selection?.rangeCount && selection.isCollapsed ? selection.getRangeAt(0) : null;
      let caret: { text: Text; offset: number } | null = null;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        const cleaned = normalizeConsoleText(text.data);
        if (cleaned === text.data) continue;
        if (activeRange?.startContainer === text) {
          const prefix = normalizeConsoleText(text.data.slice(0, activeRange.startOffset));
          caret = { text, offset: prefix.length };
        }
        text.data = cleaned;
      }
      if (caret) moveCaret(selection!, caret.text, Math.min(caret.offset, caret.text.data.length));
      const next = editorElementToMarkdown(editor);
      lastEmittedRef.current = next;
      onChange(next);
      ensureExitLine(editor);
      if (reason !== "native-input") {
        logDiagnostic("Editor change emitted", {
          reason,
          emitted_markdown_length: next.length,
        });
      }
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    selectedText: () => {
      restoreRange();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer as Element;
        if (container && editor.contains(container)) savedRangeRef.current = range.cloneRange();
      }
      return selection?.toString() ?? "";
    },
    plainText: () => {
      const editor = editorRef.current;
      return editor ? editorElementToPlainText(editor) : "";
    },
    deleteSelection: () => {
      if (readOnly) return;
      restoreRange();
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      selection.getRangeAt(0).deleteContents();
      emit("delete-selection");
    },
    insertText: (text) => {
      if (readOnly || !text) return;
      focusAndRestoreRange();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor && selection && insertTextIntoCodeBlock(editor, selection, text)) {
        logDiagnostic("Text inserted into code block", {
          insertion_length: text.length,
          insertion_line_count: normalizeConsoleText(text).split("\n").length,
        });
        emit("insert-text-code-block");
        return;
      }
      const rich = /[`*_#>\[]|^\s*(?:[-+]\s+|\d+[.)]\s+)/m.test(text);
      const html = rich ? markdownToEditorHtml(text) : escapeHtml(text).replace(/\r?\n/g, "<br>");
      document.execCommand("insertHTML", false, html);
      emit("insert-text");
    },
    insertLink: (href) => {
      if (readOnly || !/^https?:\/\//i.test(href)) return;
      focusAndRestoreRange();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection) return;
      let range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const container = range && (range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as Element);
      if (!range || !container || !editor.contains(container)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      const anchor = document.createElement("a");
      anchor.href = href;
      if (range.collapsed) anchor.textContent = href;
      else anchor.appendChild(range.extractContents());
      range.insertNode(anchor);
      const caret = document.createRange();
      caret.setStartAfter(anchor);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
      savedRangeRef.current = caret.cloneRange();
      emit("insert-link");
    },
    selectAll: () => {
      const editor = editorRef.current;
      if (!editor) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedRangeRef.current = range.cloneRange();
    },
    applyStyle: (style) => {
      if (readOnly) return;
      restoreRange();
      const range = styleSelection(style);
      if (range) savedRangeRef.current = range.cloneRange();
      emit("apply-style");
    },
    command: (command) => {
      if (readOnly) return;
      focusAndRestoreRange();
      if (command === "code-block" || command === "inline-code" || command === "quote") {
        logDiagnostic("Formatting command started", { command });
      }
      if (command === "bold" || command === "italic" || command === "undo" || command === "redo") document.execCommand(command);
      else if (command === "bullet-list") document.execCommand("insertUnorderedList");
      else if (command === "numbered-list") document.execCommand("insertOrderedList");
      else if (command === "align-left") document.execCommand("justifyLeft");
      else if (command === "align-center") document.execCommand("justifyCenter");
      else if (command === "align-right") document.execCommand("justifyRight");
      else if (command === "align-justify") document.execCommand("justifyFull");
      else if (command === "list-indent" || command === "list-outdent") {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const element = range ? selectionElement(range) : null;
        if (element?.closest("li")) {
          document.execCommand(command === "list-indent" ? "indent" : "outdent");
        }
      }
      else if (command === "paragraph") document.execCommand("formatBlock", false, "div");
      else if (command.startsWith("heading-")) document.execCommand("formatBlock", false, `h${command.slice(-1)}`);
      else if (command === "quote") toggleQuote(editorRef.current);
      else if (command === "inline-code") toggleInlineCode(editorRef.current);
      else if (command === "code-block") toggleCodeBlock(editorRef.current);
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer as Element;
        if (container && (container === editor || editor.contains(container))) {
          savedRangeRef.current = range.cloneRange();
        }
      }
      emit(`command:${command}`);
    },
  }), [readOnly, value]);

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const text = normalizeConsoleText(event.clipboardData.getData("text/plain"));
    event.preventDefault();
    const editor = editorRef.current;
    const boundaryLine = virtualBoundaryRef.current ? materializeVirtualBoundary() : null;
    if (boundaryLine) {
      boundaryLine.replaceChildren();
      const boundarySelection = window.getSelection();
      if (boundarySelection) moveCaret(boundarySelection, boundaryLine, 0);
    }
    // Cutting all text from inline code leaves WebView's caret inside an empty
    // <code>. Remove that stale formatting host before insertText, otherwise
    // the pasted plain text inherits the theme accent (green in some themes).
    if (editor) removeEmptyInlineCode(editor);
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const element = range ? selectionElement(range) : null;
    const pasteFields = {
      clipboard_text_length: text.length,
      clipboard_line_count: text.split("\n").length,
      clipboard_blank_line_count: text.split("\n").filter((line) => !line.length).length,
      clipboard_has_markdown_markers: /[`*_#>\[]|^\s*(?:[-+]\s+|\d+[.)]\s+)/m.test(text),
    };
    logDiagnostic("Paste started", pasteFields);
    let paste_path = "plain-html";
    if (editor && selection && element?.closest("pre") && insertTextIntoCodeBlock(editor, selection, text)) {
      // Inserted through a DOM Range so WebKit cannot manufacture extra PREs.
      paste_path = "code-range";
    }
    else if (/[`*_#>\[]|^\s*(?:[-+]\s+|\d+[.)]\s+)/m.test(text)) {
      document.execCommand("insertHTML", false, markdownToEditorHtml(text));
      paste_path = "markdown-html";
    } else {
      // WebView retains foreColor/hiliteColor as a typing command after a
      // fully styled selection is cut, even after its empty span is removed.
      // insertText reapplies that cached state (often as a green chip).
      // Explicit sanitized HTML inserts only the clipboard's plain text and
      // still participates in the native undo transaction.
      document.execCommand("insertHTML", false, plainTextPasteHtml(text));
    }
    logDiagnostic("Paste applied", { ...pasteFields, paste_path });
    emit(`paste:${paste_path}`);
  }

  function beforeInput(event: FormEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    if (editor) removeCodeCaretSentinelAtSelection(editor, window.getSelection());
    const boundary = virtualBoundaryRef.current;
    if (readOnly || !boundary) return;
    const input = event.nativeEvent as InputEvent;
    if (input.inputType !== "insertText" || !input.data) return;
    event.preventDefault();
    const line = materializeVirtualBoundary();
    const selection = window.getSelection();
    if (!line || !selection) return;
    line.replaceChildren();
    const text = document.createTextNode(normalizeConsoleText(input.data));
    line.appendChild(text);
    moveCaret(selection, text, text.data.length);
    emit("virtual-boundary:typing");
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!readOnly && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onRequestLink?.();
      return;
    }
    if (readOnly) return;
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const virtualBoundary = virtualBoundaryRef.current;
    if (virtualBoundary && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (!virtualBoundary.block.isConnected) clearVirtualBoundary();
      else {
        const outwardKeys = virtualBoundary.side === "after"
          ? ["ArrowRight", "ArrowDown"]
          : ["ArrowLeft", "ArrowUp"];
        const inwardKeys = virtualBoundary.side === "after"
          ? ["ArrowLeft", "ArrowUp"]
          : ["ArrowRight", "ArrowDown"];
        if (outwardKeys.includes(event.key)) {
          event.preventDefault();
          restoreVirtualBoundaryRange(virtualBoundary);
          logDiagnostic("Virtual boundary navigation retained", { key: event.key, side: virtualBoundary.side });
          return;
        }
        if (inwardKeys.includes(event.key)) {
          event.preventDefault();
          moveFromVirtualBoundaryIntoBlock(virtualBoundary);
          logDiagnostic("Virtual boundary returned to block", { key: event.key, side: virtualBoundary.side });
          return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          const entersBlock = (virtualBoundary.side === "after" && event.key === "Backspace")
            || (virtualBoundary.side === "before" && event.key === "Delete");
          if (entersBlock) moveFromVirtualBoundaryIntoBlock(virtualBoundary);
          else restoreVirtualBoundaryRange(virtualBoundary);
          logDiagnostic("Delete protected at virtual boundary", {
            key: event.key,
            side: virtualBoundary.side,
            moved_into_block: entersBlock,
          });
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          materializeVirtualBoundary();
          emit("virtual-boundary:enter");
          return;
        }
        if (event.key.length === 1) {
          event.preventDefault();
          const line = materializeVirtualBoundary();
          if (!line) return;
          line.replaceChildren();
          const text = document.createTextNode(event.key);
          line.appendChild(text);
          moveCaret(selection, text, text.data.length);
          logDiagnostic("Printable key inserted at virtual boundary", {
            key_length: event.key.length,
            side: virtualBoundary.side,
          });
          emit("virtual-boundary:keydown-typing");
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          moveFromVirtualBoundaryIntoBlock(virtualBoundary);
          return;
        }
      }
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      removeCodeCaretSentinelAtSelection(editor, selection);
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Enter") {
      if (insertCodeLineBreak(editor, selection) || insertQuoteLineBreak(editor, selection)) {
        event.preventDefault();
        logDiagnostic("Structured line break inserted", { key: event.key });
        emit("key:enter-structured");
        return;
      }
      // Notepad behavior: a plain Enter inserts a single line break inside the
      // current block instead of starting a whole new paragraph block (which
      // rendered with a visible gap and round-tripped as a blank Markdown
      // line). Lists and headings keep the browser default so Enter still
      // creates the next list item or leaves the heading.
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const element = range ? selectionElement(range) : null;
      if (!element?.closest("li, h1, h2, h3")) {
        event.preventDefault();
        document.execCommand("insertLineBreak");
        emit("key:enter-plain");
        return;
      }
      return;
    }
    if ((event.key === "Home" || event.key === "End")
      && (moveCodeCaretToLineBoundary(editor, selection, event.key)
        || moveEditorCaretToLineBoundary(editor, selection, event.key))) {
      event.preventDefault();
      return;
    }
    const isNavigationKey = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key);
    const beforeNavigationMarkup = isNavigationKey ? editor.innerHTML : "";
    if (isNavigationKey) logDiagnostic("Navigation key started", { key: event.key });
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const boundaryBlock = range ? selectionElement(range)?.closest("pre, blockquote") : null;
      const exited = exitCodeFormattingAtEnd(editor, selection) || exitQuoteFormatting(editor, selection, "after");
      if (exited) {
        event.preventDefault();
        const settledRange = selection.rangeCount ? selection.getRangeAt(0) : null;
        if (exited !== "inline" && boundaryBlock instanceof HTMLElement && settledRange?.startContainer === editor) {
          activateVirtualBoundary(boundaryBlock, "after");
        }
        logDiagnostic("Navigation exited formatted block", {
          key: event.key,
          exit_kind: exited === true ? "quote" : exited,
          dom_mutated_during_handler: beforeNavigationMarkup !== editor.innerHTML,
        });
      }
      window.setTimeout(() => logDiagnostic("Navigation key settled", {
        key: event.key,
        handled: Boolean(exited),
        dom_mutated_since_keydown: beforeNavigationMarkup !== editor.innerHTML,
      }), 0);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const boundaryBlock = range ? selectionElement(range)?.closest("pre, blockquote") : null;
      const exited = exitCodeFormattingAtStart(editor, selection) || exitQuoteFormatting(editor, selection, "before");
      if (exited) {
        event.preventDefault();
        const settledRange = selection.rangeCount ? selection.getRangeAt(0) : null;
        if (exited !== "inline" && boundaryBlock instanceof HTMLElement && settledRange?.startContainer === editor) {
          activateVirtualBoundary(boundaryBlock, "before");
        }
        logDiagnostic("Navigation exited formatted block", {
          key: event.key,
          exit_kind: exited === true ? "quote" : exited,
          dom_mutated_during_handler: beforeNavigationMarkup !== editor.innerHTML,
        });
      }
      window.setTimeout(() => logDiagnostic("Navigation key settled", {
        key: event.key,
        handled: exited,
        dom_mutated_since_keydown: beforeNavigationMarkup !== editor.innerHTML,
      }), 0);
    }
  }

  return (
    <div
      ref={editorRef}
      className="notebooks-visual-editor"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Note body"
      aria-multiline="true"
      onBeforeInput={beforeInput}
      onInput={() => emit()}
      onPaste={paste}
      onKeyDown={keyDown}
      onMouseDown={clearVirtualBoundary}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
        if (link && onOpenUrl) { event.preventDefault(); onOpenUrl(link.href); }
      }}
    />
  );
});

export default VisualMarkdownEditor;
