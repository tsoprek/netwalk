import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SafeMarkdown, { normalizeMarkdownLinks } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders formatting, lists, line breaks, and safe links", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown text={"**Login**\n*User: cisco*\n- one\n- two\n[HERO](https://example.com/path?a=1&b=2)"} />,
    );
    expect(html).toContain("<strong>Login</strong>");
    expect(html).toContain("<em>User: cisco</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<br/>");
    expect(html).toContain('href="https://example.com/path?a=1&amp;b=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("normalizes the alternate link form used by CE-Infra notes", () => {
    const normalized = normalizeMarkdownLinks("(HERO)[https://example.com]");
    expect(normalized).toBe("[HERO](https://example.com)");
    const html = renderToStaticMarkup(<SafeMarkdown text={normalized} />);
    expect(html).toContain('href="https://example.com"');
  });

  it("does not create links for unsafe schemes or render raw HTML", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown text={"[bad](javascript:alert(1))\n<script>alert(1)</script>"} />,
    );
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders terminal captures as escaped fenced code", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown text={'```text\nshow run\n<script>bad</script>\n```'} />,
    );
    expect(html).toContain('<pre class="safe-markdown-code">');
    expect(html).toContain('class="language-text"');
    expect(html).toContain("show run");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("does not treat underscores inside technical identifiers as emphasis", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown text={"PORT_CHANNEL_STATE and _intentional emphasis_"} />,
    );
    expect(html).toContain("PORT_CHANNEL_STATE");
    expect(html).toContain("<em>intentional emphasis</em>");
    expect(html).not.toContain("PORT<em>CHANNEL</em>STATE");
  });

  it("renders Markdown quotes and inline code", () => {
    const html = renderToStaticMarkup(<SafeMarkdown text={"> Check the router\n> before changing `BGP`"} />);
    expect(html).toContain('<blockquote class="safe-markdown-quote">');
    expect(html).toContain("Check the router");
    expect(html).toContain("<code>BGP</code>");
  });
});
