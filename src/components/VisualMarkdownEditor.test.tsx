// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  editorElementToMarkdown,
  editorElementToPlainText,
  ensureExitLine,
  exitCodeFormattingAtEnd,
  exitCodeFormattingAtStart,
  insertCodeLineBreak,
  insertTextIntoCodeBlock,
  markdownToEditorHtml,
  moveCodeCaretToLineBoundary,
  moveEditorCaretToLineBoundary,
  notesEditorDiagnosticSnapshot,
  plainTextPasteHtml,
  removeEmptyCodeBlocks,
  removeEmptyInlineCode,
  toggleCodeBlock,
  toggleInlineCode,
} from "./VisualMarkdownEditor";

describe("VisualMarkdownEditor conversion", () => {
  it("keeps diagnostics structural and excludes note contents", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div>private-password-value</div><pre data-language="text"><code>secret-command</code></pre>';
    const snapshot = notesEditorDiagnosticSnapshot(editor);

    expect(snapshot).toMatchObject({
      root_child_count: 2,
      root_block_types: "div,pre",
      code_block_count: 1,
      editor_text_length: 36,
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-password-value");
    expect(JSON.stringify(snapshot)).not.toContain("secret-command");
  });

  it("turns clipboard plain text into explicit style-free insertion HTML", () => {
    expect(plainTextPasteHtml('passwd\n<span style="color: green">bad</span>')).toBe(
      'passwd<br>&lt;span style=&quot;color: green&quot;&gt;bad&lt;/span&gt;',
    );
  });

  it("renders Markdown as editable rich content without visible syntax", () => {
    const html = markdownToEditorHtml("# Runbook\n\n**Important** and `show version`\n\n```text\nshow run\n```");
    expect(html).toContain("<h1>Runbook</h1>");
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain("<code>show version</code>");
    expect(html).toContain('<pre data-language="text"><code>show run</code></pre>');
    expect(html).not.toContain("**Important**");
    expect(html).not.toContain("```text");
  });

  it("keeps underscores in terminal-style identifiers when editing and saving", () => {
    const editor = document.createElement("div");
    editor.innerHTML = markdownToEditorHtml("PORT_CHANNEL_STATE and _intentional emphasis_\n\n```text\nshow PORT_CHANNEL_STATE\n```");

    expect(editor.innerHTML).toContain("PORT_CHANNEL_STATE");
    expect(editor.innerHTML).toContain("<em>intentional emphasis</em>");
    expect(editorElementToMarkdown(editor)).toContain("PORT_CHANNEL_STATE and *intentional emphasis*");
    expect(editorElementToMarkdown(editor)).toContain("```text\nshow PORT_CHANNEL_STATE\n```");
  });

  it("recovers attributed clipboard markup already stored in a note", () => {
    const stored = '<font color="#d6deea" face="Inter, system-ui"><span style="font-size: 14px; white-space-collapse: collapse;"><br></span></font><font color="#d6deea"><span style="font-size: 14px; white-space-collapse: collapse;">npm run catwalk:build — —build</span></font>';
    const html = markdownToEditorHtml(stored);
    expect(html).not.toContain("&lt;font");
    expect(html).toContain("npm run catwalk:build — —build");
  });

  it("recovers attributed markup escaped by an older rich-note serializer", () => {
    const stored = '<!--catwalk-rich-->\n&lt;font color=&quot;#d6deea&quot;&gt;&lt;span style=&quot;white-space-collapse: collapse;&quot;&gt;npm run catwalk:build — —build&lt;/span&gt;&lt;/font&gt;';
    const html = markdownToEditorHtml(stored);
    expect(html).not.toContain("&lt;font");
    expect(html).toBe("<div>npm run catwalk:build — —build</div>");
  });

  it("removes stored group-separator rectangles from normal and code text", () => {
    expect(markdownToEditorHtml("first\u001d\n\n```text\nsecond\u001d\n```")).toBe(
      '<div>first</div><pre data-language="text"><code>second</code></pre>',
    );
    const editor = document.createElement("div");
    editor.innerHTML = `<pre data-language="text"><code>one${String.fromCharCode(0x1d)}two</code></pre>`;
    expect(editorElementToMarkdown(editor)).toContain("onetwo");
    expect(editorElementToMarkdown(editor)).not.toContain("\u001d");
  });

  it("drops unsupported rich wrappers while preserving their text", () => {
    const html = markdownToEditorHtml('<!--catwalk-rich-->\n<div><font color="#fff">command</font></div>');
    expect(html).toBe("<div>command</div>");
  });

  it("serializes visual formatting back to Markdown for sync", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<h2>Checks</h2><div><strong>Bold</strong> and <code>inline</code></div><ul><li>one</li><li>two</li></ul><pre data-language=\"text\"><code>show clock</code></pre>";
    const markdown = editorElementToMarkdown(editor);
    expect(markdown).toContain("## Checks");
    expect(markdown).toContain("**Bold** and `inline`");
    expect(markdown).toContain("- one\n- two");
    expect(markdown).toContain("```text\nshow clock\n```");
  });

  it("normalizes trailing blank lines at code-fence boundaries", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show version\n\n</code></pre>';
    expect(editorElementToMarkdown(editor)).toBe("```text\nshow version\n```");
    expect(markdownToEditorHtml("```text\nshow version\n\n\n```")).toBe(
      '<pre data-language="text"><code>show version</code></pre>',
    );
  });

  it("turns only the selected lines in a paragraph into a code block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>before<br>show clock<br>show version<br>after</div>";
    document.body.appendChild(editor);
    const paragraph = editor.firstElementChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(paragraph.childNodes[2], 0);
    range.setEnd(paragraph.childNodes[4], paragraph.childNodes[4].textContent!.length);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.innerHTML).toBe('<div>before</div><pre data-language="text"><code>show clock\nshow version</code></pre><div>after</div>');
    expect(editorElementToMarkdown(editor)).toBe("before\n\n```text\nshow clock\nshow version\n```\n\nafter");
    editor.remove();
  });

  it("never replaces the React-owned editor root for a stale root selection", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>before</div><pre data-language=\"text\"><code>show clock</code></pre>";
    document.body.appendChild(editor);
    const original = editor.innerHTML;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.isConnected).toBe(true);
    expect(editor.innerHTML).toBe(original);
    editor.remove();
  });

  it("creates a code block from a collapsed caret on an empty first line", () => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.innerHTML).toBe('<pre data-language="text"><code><br></code></pre>');
    expect(editor.isConnected).toBe(true);
    editor.remove();
  });

  it("creates a code block from direct text on the first editor line", () => {
    const editor = document.createElement("div");
    editor.textContent = "npm run catwalk:build";
    document.body.appendChild(editor);
    const text = editor.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.innerHTML).toBe('<pre data-language="text"><code>npm run catwalk:build</code></pre>');
    expect(selection.anchorNode?.textContent).toBe("npm run catwalk:build");
    expect(selection.anchorOffset).toBe(3);
    editor.remove();
  });

  it("wraps a selection of bare root text into a code block", () => {
    const editor = document.createElement("div");
    editor.textContent = "alpha beta gamma";
    document.body.appendChild(editor);
    const text = editor.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 10);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.innerHTML).toBe('<div>alpha </div><pre data-language="text"><code>beta</code></pre><div> gamma</div>');
    expect(editorElementToMarkdown(editor)).toContain("```text\nbeta\n```");
    editor.remove();
  });

  it("wraps a full bare-root selection into a single code block", () => {
    const editor = document.createElement("div");
    editor.textContent = "show version";
    document.body.appendChild(editor);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleCodeBlock(editor);

    expect(editor.innerHTML).toBe('<pre data-language="text"><code>show version</code></pre>');
    editor.remove();
  });

  it("formats a triple-click line selection without empty code chips on adjacent lines", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>above</div><div>The ultimate command-line utility</div><div>below</div>";
    document.body.appendChild(editor);
    const selectedText = editor.children[1].firstChild!;
    const nextLineText = editor.children[2].firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(selectedText, 0);
    // Browser triple-click includes the paragraph terminator and ends at the
    // start of the following line.
    range.setEnd(nextLineText, 0);
    selection.removeAllRanges();
    selection.addRange(range);

    toggleInlineCode(editor);

    expect(editor.innerHTML).toBe("<div>above</div><div><code>The ultimate command-line utility</code></div><div>below</div>");
    expect(Array.from(editor.querySelectorAll("code")).every((code) => Boolean(code.textContent))).toBe(true);
    editor.remove();
  });

  it("moves the caret out of empty inline code left by cutting its full contents", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>before <code></code> after</div>";
    document.body.appendChild(editor);
    const code = editor.querySelector("code")!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(code, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    removeEmptyInlineCode(editor);

    expect(editor.querySelector("code")).toBeNull();
    expect(selection.anchorNode).toBe(editor.firstElementChild);
    expect(selection.anchorOffset).toBe(1);
    editor.remove();
  });

  it("removes an empty rich color and highlight span before plain-text paste", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div>before <span style="color: green; background-color: darkgreen"></span> after</div>';
    document.body.appendChild(editor);
    const styled = editor.querySelector("span")!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(styled, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    removeEmptyInlineCode(editor);

    expect(editor.querySelector("span[style]")).toBeNull();
    expect(selection.anchorNode).toBe(editor.firstElementChild);
    expect(selection.anchorOffset).toBe(1);
    editor.remove();
  });

  it("consumes incomplete Markdown markers without hanging", () => {
    expect(markdownToEditorHtml("- \nnext")).toContain("- ");
    expect(markdownToEditorHtml("1. \nnext")).toContain("1. ");
    expect(markdownToEditorHtml("# \nnext")).toContain("# ");
  });

  it("round-trips sanitized selection-specific text styles", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div>plain <span style="font-family: Georgia; font-size: 18px; color: rgb(239, 83, 80); background-color: rgb(81, 50, 105)">styled</span></div>';
    const stored = editorElementToMarkdown(editor);
    expect(stored).toContain("<!--catwalk-rich-->");
    const html = markdownToEditorHtml(stored);
    expect(html).toContain("font-family:Georgia");
    expect(html).toContain("font-size:18px");
    expect(html).toContain("color:rgb(239, 83, 80)");
    expect(html).toContain("background-color:rgb(81, 50, 105)");
  });

  it("round-trips theme-aware text color and highlight resets", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div><span data-clear-color="true">default text</span> <span data-clear-highlight="true">no highlight</span></div>';
    const stored = editorElementToMarkdown(editor);
    expect(stored).toContain("<!--catwalk-rich-->");
    expect(stored).toContain('data-clear-color="true"');
    expect(stored).toContain('data-clear-highlight="true"');
    const html = markdownToEditorHtml(stored);
    expect(html).toContain('data-clear-color="true"');
    expect(html).toContain('data-clear-highlight="true"');
  });

  it("round-trips text alignment and nested list indentation", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div style="text-align: center">Centered</div><ol><li>First<ol><li>Nested</li></ol></li><li>Second</li></ol>';
    const stored = editorElementToMarkdown(editor);
    expect(stored).toContain("<!--catwalk-rich-->");
    expect(stored).toContain('style="text-align:center"');
    expect(stored).toContain("<ol><li>First<ol><li>Nested</li></ol></li><li>Second</li></ol>");

    const html = markdownToEditorHtml(stored);
    expect(html).toContain('<div style="text-align:center">Centered</div>');
    expect(html).toContain("<ol><li>First<ol><li>Nested</li></ol></li><li>Second</li></ol>");
  });

  it("moves the caret out of inline code at its right boundary", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>Run <code>show version</code></div>";
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const range = document.createRange();
    range.setStart(codeText, codeText.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(exitCodeFormattingAtEnd(editor, selection)).toBe("inline");
    expect(editor.innerHTML).toBe("<div>Run <code>show version</code>&nbsp;</div>");
    expect(selection.anchorNode).toBe(editor.firstElementChild!.lastChild);
    expect(selection.anchorOffset).toBe(1);
    expect(editorElementToMarkdown(editor)).toBe("Run `show version`");
    (selection.anchorNode as Text).appendData("next");
    expect(editor.querySelector("code")?.textContent).toBe("show version");
    expect(editorElementToMarkdown(editor)).toBe("Run `show version` next");
    editor.remove();
  });

  it("exits inline code from WebKit's parent-boundary caret representation", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div><code>show version</code></div>";
    document.body.appendChild(editor);
    const paragraph = editor.firstElementChild!;
    const range = document.createRange();
    range.setStart(paragraph, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(exitCodeFormattingAtEnd(editor, selection)).toBe("inline");
    expect(editor.innerHTML).toBe("<div><code>show version</code>&nbsp;</div>");
    expect(selection.anchorNode).toBe(paragraph.lastChild);
    expect(selection.anchorOffset).toBe(1);
    editor.remove();
  });

  it("moves after a code block without creating a paragraph", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show clock</code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const range = document.createRange();
    range.setStart(codeText, codeText.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(exitCodeFormattingAtEnd(editor, selection)).toBe("block");
    expect(editor.innerHTML).toBe('<pre data-language="text"><code>show clock</code></pre>');
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(1);
    editor.remove();
  });

  it("exits a code block whose last line ends with a trailing space", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show version </code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    // WebKit collapses the caret to before the trailing space at the block end.
    const range = document.createRange();
    range.setStart(codeText, codeText.textContent!.length - 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(exitCodeFormattingAtEnd(editor, selection)).toBe("block");
    expect(editor.innerHTML).toBe('<pre data-language="text"><code>show version </code></pre>');
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(1);
    editor.remove();
  });

  it("does not add placeholder lines after a trailing code block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show version</code></pre>';
    ensureExitLine(editor);
    expect(editor.innerHTML).toBe('<pre data-language="text"><code>show version</code></pre>');
    ensureExitLine(editor);
    expect(editor.querySelectorAll("div")).toHaveLength(0);
    expect(editorElementToMarkdown(editor)).toBe("```text\nshow version\n```");
  });

  it("removes synthetic exit lines left by older builds", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show version</code></pre><div data-catwalk-exit-line="true"><br><br><br></div>';
    document.body.appendChild(editor);
    const exitLine = editor.lastElementChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(exitLine, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    ensureExitLine(editor);

    expect(editor.contains(exitLine)).toBe(false);
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(1);
    expect(editorElementToMarkdown(editor)).toBe("```text\nshow version\n```");
    editor.remove();
  });

  it("moves before a code block without changing the document", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show clock</code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const range = document.createRange();
    range.setStart(codeText, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(exitCodeFormattingAtStart(editor, selection)).toBe("block");
    expect(editor.innerHTML).toBe('<pre data-language="text"><code>show clock</code></pre>');
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(0);
    editor.remove();
  });

  it("removes empty persisted code blocks without removing the active new block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>show clock</code></pre><pre data-language="text"><code><br></code></pre><pre data-language="text"><code>show version</code></pre>';
    document.body.appendChild(editor);

    removeEmptyCodeBlocks(editor);

    expect(editor.querySelectorAll("pre")).toHaveLength(2);
    expect(editorElementToMarkdown(editor)).toBe("```text\nshow clock\n```\n\n```text\nshow version\n```");

    const active = document.createElement("pre");
    active.innerHTML = "<code><br></code>";
    editor.appendChild(active);
    const range = document.createRange();
    range.selectNodeContents(active.querySelector("code")!);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    removeEmptyCodeBlocks(editor);
    expect(editor.contains(active)).toBe(true);
    editor.remove();
  });

  it("extracts multi-line plain text with block boundaries preserved", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<div>show version</div><pre data-language="text"><code>conf t\ninterface Gi0/1</code></pre><div>end</div>';
    expect(editorElementToPlainText(editor)).toBe("show version\nconf t\ninterface Gi0/1\nend");
  });

  it("inserts Enter as a newline inside the same code block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>firstsecond</code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(codeText, 5);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(insertCodeLineBreak(editor, selection)).toBe(true);
    expect(editor.querySelectorAll("pre")).toHaveLength(1);
    expect(editor.querySelector("code")?.textContent).toBe("first\nsecond");
    expect(editorElementToMarkdown(editor)).toContain("first\nsecond");
    editor.remove();
  });

  it("renders the first trailing Enter as a visible code row without saving an extra blank line", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>first</code></pre>';
    document.body.appendChild(editor);
    const code = editor.querySelector("code")!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(code);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(insertCodeLineBreak(editor, selection)).toBe(true);
    expect(code.textContent).toBe("first\n");
    expect(code.querySelectorAll("[data-catwalk-code-caret]")).toHaveLength(1);
    expect(editorElementToMarkdown(editor)).toBe("```text\nfirst\n```");
    expect(editorElementToPlainText(editor)).toBe("first");

    expect(insertCodeLineBreak(editor, selection)).toBe(true);
    expect(code.textContent).toBe("first\n\n");
    expect(code.querySelectorAll("[data-catwalk-code-caret]")).toHaveLength(1);
    editor.remove();
  });

  it("keeps multiline clipboard text and blank lines inside one code block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>beforeafter</code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(codeText, 6);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(insertTextIntoCodeBlock(editor, selection, "one\r\n\r\ntwo\n")).toBe(true);

    expect(editor.querySelectorAll("pre")).toHaveLength(1);
    expect(editor.querySelector("code")?.textContent).toBe("beforeone\n\ntwo\nafter");
    expect(editorElementToMarkdown(editor)).toBe("```text\nbeforeone\n\ntwo\nafter\n```");
    editor.remove();
  });

  it("moves Home and End to the current line boundaries in a code block", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<pre data-language="text"><code>first line\nsecond line\nthird line</code></pre>';
    document.body.appendChild(editor);
    const codeText = editor.querySelector("code")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(codeText, 15);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(moveCodeCaretToLineBoundary(editor, selection, "Home")).toBe(true);
    expect(selection.anchorNode).toBe(codeText);
    expect(selection.anchorOffset).toBe(11);

    expect(moveCodeCaretToLineBoundary(editor, selection, "End")).toBe(true);
    expect(selection.anchorNode).toBe(codeText);
    expect(selection.anchorOffset).toBe(22);
    editor.remove();
  });

  it("moves Home and End to line boundaries in normal text", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<div>first line<br>second <strong>line</strong><br>third line</div>";
    document.body.appendChild(editor);
    const secondLineText = editor.querySelector("div")!.childNodes[2];
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(secondLineText, 4);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(moveEditorCaretToLineBoundary(editor, selection, "Home")).toBe(true);
    expect(selection.anchorNode).toBe(editor.querySelector("div"));
    expect(selection.anchorOffset).toBe(2);

    expect(moveEditorCaretToLineBoundary(editor, selection, "End")).toBe(true);
    expect(selection.anchorNode).toBe(editor.querySelector("strong")!.firstChild);
    expect(selection.anchorOffset).toBe(4);
    editor.remove();
  });
});
