import { describe, expect, it } from "vitest";

import { isInputFlow } from "./ConsentGate.js";

describe("major-announcement interruption boundaries", () => {
  it("does not open over entry, scan, voice, transaction or import flows", () => {
    for (const path of [
      "/add",
      "/record",
      "/scan",
      "/voice/review",
      "/transactions/abc",
      "/import",
      "/import-ledger",
      "/books/abc/settings/import",
    ]) {
      expect(isInputFlow(path)).toBe(true);
    }
  });

  it("allows the notice on normal navigation surfaces", () => {
    for (const path of ["/", "/me", "/start", "/update", "/settings", "/ledger"]) {
      expect(isInputFlow(path)).toBe(false);
    }
  });
});
