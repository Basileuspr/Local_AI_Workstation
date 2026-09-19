import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { trustedUrl, externalUrl } = require("../../electron/security");
const { KEYS, migrateValues } = require("../../electron/preferenceMigration");

describe("desktop trust boundary", () => {
  it("accepts the standard private scheme despite Node's null origin", () => {
    expect(new URL("app://local/index.html").origin).toBe("null");
    expect(trustedUrl("app://local/index.html?apiPort=8001")).toBe(true);
    expect(trustedUrl("http://localhost:5173/", "http://localhost:5173")).toBe(true);
  });
  it("rejects prefix tricks, credentials, other ports, null and files", () => {
    for (const url of ["app://local.evil/x", "app://local@evil/x", "app://local:82/", "file:///app/dist/index.html", "null", "http://localhost:5173@evil/", "http://localhost:51730/", "http://evil/?http://localhost:5173"]) {
      expect(trustedUrl(url, "http://localhost:5173"), url).toBe(false);
    }
    expect(externalUrl("https://example.com/article")).toBe(true);
    for (const url of ["javascript:alert(1)", "file:///secrets", "https://user@evil/", "http://localhost:8000/image?law_token=secret"]) expect(externalUrl(url)).toBe(false);
  });
  it("migrates old settings without overwriting newer values or custom buttons", () => {
    const old = { [KEYS[0]]: JSON.stringify({temperature: .4, customProfiles:[{id:'old'}, {id:'both', name:'old'}], imageSettings:{steps:30, seed:42}}) };
    const current = { [KEYS[0]]: JSON.stringify({temperature:.8, customProfiles:[{id:'both', name:'new'}], imageSettings:{steps:24}}) };
    const merged = JSON.parse(migrateValues(old, current)[KEYS[0]]);
    expect(merged).toEqual({temperature:.8, customProfiles:[{id:'old'}, {id:'both', name:'new'}], imageSettings:{steps:24, seed:42}});
    expect(JSON.parse(old[KEYS[0]]).temperature).toBe(.4);
    expect(() => migrateValues({[KEYS[0]]:'invalid'}, {})).toThrow();
  });
});
