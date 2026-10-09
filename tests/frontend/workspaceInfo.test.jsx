import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { appTabs, appTabLabels } from "../../src/navigation";
import { workspaceHelp } from "../../src/workspaceHelp";
import WorkspaceInfo, { WorkspaceHelpContent } from "../../src/components/WorkspaceInfo";

describe("workspace information", () => {
  it("explains visible workspace pairing and the distinction between hiding and stopping Browser or Generate", () => {
    for (const tab of ["generate", "browser", "audio"]) {
      const html = renderToStaticMarkup(<WorkspaceHelpContent tab={tab} />);
      expect(html).toContain("Side pane selector in the top toolbar");
      expect(html).toContain("Model jobs share the Prompt Queue");
    }
    expect(renderToStaticMarkup(<WorkspaceHelpContent tab="browser" />)).toContain("use Close page to close it");
    expect(renderToStaticMarkup(<WorkspaceHelpContent tab="generate" />)).toContain("while images generate");
  });
  it("provides an explicit guide for every registered tab", () => {
    expect(Object.keys(workspaceHelp).sort()).toEqual([...appTabs].sort());
    for (const tab of appTabs) {
      const guide = workspaceHelp[tab];
      for (const part of ["purpose", "example"]) expect(guide[part].length, `${tab}: ${part}`).toBeGreaterThan(35);
      expect(guide).not.toHaveProperty('settings');
      expect(guide.sections.length, tab).toBeGreaterThan(0);
      for (const [heading, entries] of guide.sections) {
        expect(heading.length).toBeGreaterThan(0);
        expect(entries.length).toBeGreaterThan(0);
        expect(new Set(entries.map(([name]) => name)).size).toBe(entries.length);
        for (const [name, definition] of entries) {
          expect(name.length).toBeGreaterThan(0);
          expect(definition.length, `${tab}: ${name}`).toBeGreaterThan(15);
        }
      }
    }
  });
  it.each(appTabs)("%s has a labeled Info dialog and its own controls and example", tab => {
    const html = renderToStaticMarkup(<WorkspaceInfo tab={tab} />);
    const label = (tab === "chats" ? "Chats" : appTabLabels[tab]).replace(/&/g, '&amp;');
    expect(html).toContain(`aria-label="${label} information"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(`Close ${label} information`);
    expect(html).toContain('class="workspace-control-help"');
    expect(html).not.toMatch(/<p[ >]/);
    expect(html).toContain('<h3>Example</h3>');
    expect(html).not.toContain('<details');
    expect(html.match(/<dialog/g)).toHaveLength(1);
  });
  it('explains chat models, settings and the actual tool-call boundary individually', () => {
    const chat = renderToStaticMarkup(<WorkspaceHelpContent tab="chats" />);
    for (const name of ['Chat model', 'Send', 'Attach / paste', 'Response length', 'Temperature', 'Top P', 'Top K', 'Repeat Penalty', 'System Prompt', 'Durable Memory', 'Tool registry', 'Canvas', '/docx']) expect(chat).toContain(`<dt>${name}</dt>`);
    expect(chat).toContain('Enable Local model tool use');
    expect(chat).toContain('before chat history');
  });
  it('documents direct face naming and persistent Browser logins', () => {
    const faces = renderToStaticMarkup(<WorkspaceHelpContent tab="image-manager" />);
    expect(faces).toContain('<dt>Name / Save name</dt>');
    expect(faces).toContain('whole person group');
    const browser = renderToStaticMarkup(<WorkspaceHelpContent tab="browser" />);
    expect(browser).toContain('persistent browser profile');
    expect(browser).not.toContain('separate temporary session');
  });
  it("keeps all existing audio guides together, without showing them on other tabs", () => {
    const audio = renderToStaticMarkup(<WorkspaceHelpContent tab="audio" />);
    for (const text of ["Separate speakers", "Voice cloning", "48 kHz", "Chatterbox", "110 MB"]) expect(audio).toContain(text);
    const registry = renderToStaticMarkup(<WorkspaceHelpContent tab="shortcuts" />);
    expect(registry).toContain('English / US keyboard');
    expect(registry).toContain('custom icons');
    expect(registry).not.toContain('Voice cloning');
  });
  it("retains Generate and LoRA scales and shows the actual learning-rate comparison", () => {
    const generate = renderToStaticMarkup(<WorkspaceHelpContent tab="generate" />);
    expect(generate).toContain('guidance 5 vs 20');
    expect(generate).toContain('Tab options → Reset defaults');
    const lora = renderToStaticMarkup(<WorkspaceHelpContent tab="lora" learningRate={0.00005} />);
    expect(lora).toContain('5e-5');
    expect(lora).toContain('0.5');
    expect(lora).toContain('Your setting');
    expect(renderToStaticMarkup(<WorkspaceHelpContent tab="lora" />)).not.toContain('Your setting');
  });
  it("removes only the obsolete help disclosures, retaining interactive folders and settings", () => {
    const source = name => readFileSync(new URL(`../../src/components/${name}.jsx`, import.meta.url), "utf8");
    for (const [name, marker] of [["ShortcutRegistry", "registry-help"], ["AudioWorkspace", "audio-help"], ["AudioExtractor", "audio-help"], ["VoiceCloningPanel", "audio-help"], ["ViewerBrowser", "browser-help"], ["HashAuditor", "hash-help"], ["FunctionBuilder", "How to build the examples"], ["InputBar", "chat-composer-help"]]) expect(source(name)).not.toContain(marker);
    expect(source("ShortcutRegistry")).toContain('aria-expanded={open}');
    expect(source("SpreadsheetViewer")).toContain('Columns to include in chat');
    expect(source("CodeViewer")).toContain('HTML to style');
    expect(source("ChatInfluences")).toContain('<summary>Response influences');
    expect(source("FolderReview")).not.toContain('folder-review-help');
    expect(source("FolderReview")).toContain('Batch size and coverage limits');
  });
});
