import { describe, expect, it } from "vitest";

import { guestAttachmentMatches, sortGuestAttachments } from "./GuestAttachmentsPage.js";
import type { GuestAttachment } from "../lib/guest/attachments.js";

function item(id: string, name: string, mediaType: string, sizeBytes: number, createdAt: number): GuestAttachment {
  return { id, guestId: "g", guestBookId: "b", entryIds: ["t"], name, mediaType, sizeBytes, createdAt, blob: new Blob([]) };
}
const files = [item("a", "发票.PNG", "image/png", 300, 1), item("b", "合同.pdf", "application/pdf", 100, 3), item("c", "录音.m4a", "audio/mp4", 200, 2)];

describe("游客附件页：筛选与排序", () => {
  it("按名称（不分大小写）与类型筛选", () => {
    expect(files.filter((f) => guestAttachmentMatches(f, "发票", "")).map((f) => f.id)).toEqual(["a"]);
    expect(files.filter((f) => guestAttachmentMatches(f, "", "image/")).map((f) => f.id)).toEqual(["a"]);
    expect(files.filter((f) => guestAttachmentMatches(f, "", "application/pdf")).map((f) => f.id)).toEqual(["b"]);
    expect(files.filter((f) => guestAttachmentMatches(f, " png ", "")).map((f) => f.id)).toEqual(["a"]);
    expect(files.filter((f) => guestAttachmentMatches(f, "", "")).length).toBe(3);
  });

  it("新到旧、旧到新、大到小、小到大，且不改原数组", () => {
    expect(sortGuestAttachments(files, "newest").map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(sortGuestAttachments(files, "oldest").map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(sortGuestAttachments(files, "largest").map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(sortGuestAttachments(files, "smallest").map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});
