import { describe, expect, it } from "vitest";

import {
  isReadable,
  readableItems,
  routeRecognition,
} from "./routeDecision.js";
import { candidate, item } from "./testFixtures.js";

describe("routeRecognition", () => {
  it("keeps single-detail screenshots on the original single-entry flow", () => {
    expect(routeRecognition([item(), item({ index: 1, candidates: [candidate({ imageIndex: 1, candidateId: "img1-1" })] })])).toBe("single");
  });

  it("puts a transaction-list screenshot into a batch", () => {
    expect(
      routeRecognition([
        item({
          pageType: "transaction-list",
          candidates: [candidate({ candidateId: "img0-1" })],
        }),
      ]),
    ).toBe("batch");
  });

  it("puts a mixed upload into one batch, so there are not two review flows", () => {
    expect(
      routeRecognition([
        item(),
        item({
          index: 1,
          pageType: "transaction-list",
          candidates: [candidate({ candidateId: "img1-1", imageIndex: 1 })],
        }),
      ]),
    ).toBe("batch");
  });

  it("asks the user when the page type is unknown", () => {
    expect(
      routeRecognition([
        item({ pageType: "unknown", layoutLabel: null, requiresUserChoice: true, candidates: [] }),
      ]),
    ).toBe("ask");
  });

  it("asks when a page claims to be a list but yields no transaction", () => {
    expect(
      routeRecognition([
        item({ pageType: "transaction-list", candidates: [], requiresUserChoice: true }),
      ]),
    ).toBe("ask");
  });

  it("does not ask for a low-confidence single detail: the type is still known", () => {
    expect(
      routeRecognition([
        item({
          pageType: "single-detail",
          requiresUserChoice: true,
          warnings: ["版式未验证"],
        }),
      ]),
    ).toBe("single");
  });

  it("keeps a pre-S15-B response on the old flow", () => {
    expect(
      routeRecognition([
        item({
          pageType: null,
          layoutLabel: null,
          requiresUserChoice: false,
          candidates: [],
        }),
      ]),
    ).toBe("single");
  });
});

describe("readable items", () => {
  it("drops a screenshot nothing was read from", () => {
    expect(isReadable(item({ ok: false, draft: null, candidates: [] }))).toBe(false);
    expect(isReadable(item())).toBe(true);
  });

  it("accepts a legacy draft without candidates", () => {
    expect(isReadable(item({ candidates: [] }))).toBe(true);
  });

  it("filters a batch result down to the pages worth routing", () => {
    expect(readableItems([item(), item({ index: 1, ok: false, draft: null, candidates: [] })])).toHaveLength(1);
  });
});
