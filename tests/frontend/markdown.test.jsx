/**
 * Tests for the hand-rolled markdown renderer.
 *
 * Every assistant reply passes through this, so a parsing regression is
 * immediately visible in every chat. Rendered with react-dom/server to keep
 * the suite free of a DOM implementation.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownMessage from "../../src/components/MarkdownMessage.jsx";

const render = (source) => renderToStaticMarkup(<MarkdownMessage>{source}</MarkdownMessage>);

describe("block elements", () => {
  it("wraps output in the markdown container", () => {
    expect(render("hello")).toContain('class="message-markdown"');
  });

  it("renders a plain paragraph", () => {
    expect(render("Just some prose.")).toContain("<p>Just some prose.</p>");
  });

  it.each([1, 2, 3, 4, 5, 6])("renders an h%i heading", (level) => {
    const html = render(`${"#".repeat(level)} Title`);

    expect(html).toContain(`<h${level}>Title</h${level}>`);
  });

  it("does not treat a hash without a space as a heading", () => {
    expect(render("#NotAHeading")).toContain("<p>#NotAHeading</p>");
  });

  it("renders a horizontal rule", () => {
    expect(render("---")).toContain("<hr/>");
  });

  it("renders a blockquote", () => {
    const html = render("> quoted line");

    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted line");
  });

  it("joins consecutive blockquote lines into one block", () => {
    const html = render("> first\n> second");

    expect(html.match(/<blockquote>/g)).toHaveLength(1);
    expect(html).toContain("<br/>");
  });

  it("keeps consecutive prose lines in a single paragraph with line breaks", () => {
    const html = render("line one\nline two");

    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html).toContain("<br/>");
  });

  it("splits paragraphs on a blank line", () => {
    const html = render("first para\n\nsecond para");

    expect(html.match(/<p>/g)).toHaveLength(2);
  });
});

describe("code blocks", () => {
  it("renders a fenced block", () => {
    const html = render("```\nconst x = 1;\n```");

    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("applies a language class when the fence declares one", () => {
    expect(render("```python\nprint(1)\n```")).toContain('class="language-python"');
  });

  it("omits the language class for a bare fence", () => {
    expect(render("```\nplain\n```")).not.toContain("language-");
  });

  it("preserves multiple lines and indentation", () => {
    const html = render("```js\nfunction f() {\n  return 2;\n}\n```");

    expect(html).toContain("function f() {\n  return 2;\n}");
  });

  it("does not interpret markdown inside a code block", () => {
    const html = render("```\n**not bold** # not heading\n```");

    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<h1>");
  });

  it("recovers from an unterminated fence instead of dropping content", () => {
    const html = render("```js\nunclosed code");

    expect(html).toContain("unclosed code");
  });
});

describe("lists", () => {
  it("renders an unordered list", () => {
    const html = render("- one\n- two");

    expect(html).toContain("<ul>");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it.each(["-", "*", "+"])("accepts %s as a bullet marker", (marker) => {
    expect(render(`${marker} item`)).toContain("<ul>");
  });

  it("renders an ordered list", () => {
    const html = render("1. first\n2. second");

    expect(html).toContain("<ol>");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("accepts the paren form of ordered markers", () => {
    expect(render("1) first")).toContain("<ol>");
  });

  it("nests an indented sublist inside its parent item", () => {
    const html = render("- parent\n  - child");

    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).toContain("child");
  });

  it("starts a new list when the marker type changes", () => {
    const html = render("- bullet\n1. numbered");

    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
  });
});

describe("inline formatting", () => {
  it("renders inline code", () => {
    expect(render("use `npm run build` now")).toContain("<code>npm run build</code>");
  });

  it.each(["**bold**", "__bold__"])("renders %s as strong", (source) => {
    expect(render(source)).toContain("<strong>bold</strong>");
  });

  it.each(["*em*", "_em_"])("renders %s as emphasis", (source) => {
    expect(render(source)).toContain("<em>em</em>");
  });

  it("formats inline markup inside headings", () => {
    expect(render("## A **bold** heading")).toContain("<strong>bold</strong>");
  });

  it("formats inline markup inside list items", () => {
    expect(render("- an `inline` item")).toContain("<code>inline</code>");
  });

  it("escapes HTML rather than injecting it", () => {
    const html = render("<script>alert(1)</script>");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("degenerate input", () => {
  it.each([
    ["empty string", ""],
    ["only whitespace", "   \n  \n"],
    ["null", null],
    ["undefined", undefined],
  ])("renders %s without throwing", (_label, source) => {
    expect(() => render(source)).not.toThrow();
  });

  it("normalizes windows line endings", () => {
    const html = render("# Title\r\n\r\nbody");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>body</p>");
  });

  it("renders a realistic mixed reply end to end", () => {
    const html = render(
      ["# Results", "", "Here is **what** I found:", "", "- item `one`", "- item two", "", "```js", "const ok = true;", "```", "", "> a closing note"].join("\n")
    );

    expect(html).toContain("<h1>Results</h1>");
    expect(html).toContain("<strong>what</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain('class="language-js"');
    expect(html).toContain("<blockquote>");
  });
});
