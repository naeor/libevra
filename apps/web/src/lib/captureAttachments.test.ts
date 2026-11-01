import { describe, expect, it } from "vitest";
import { captureAttachmentLimit, captureDraftsFor, billAttachmentMapping, resolveAttachmentDraft } from "./captureAttachments.js";
import type { PendingAttachment } from "./attachments.js";

function file(targets = ["a", "b"], bytes = 4): PendingAttachment {
  return { id: "file", ownerId: "u", bookId: "book", entryIds: [], name: "receipt.pdf", blob: new Blob([new Uint8Array(bytes)]), createdAt: 1, error: null,
    draftLink: { scope: "photo", targets: targets.map(id => ({ id, label: id })), resolved: {} } };
}
describe("录入附件关联", () => {
  it("账号、账本、录入方式隔离，已排队的文件不会再次绑定", () => {
    const own = file();
    expect(captureDraftsFor([own, { ...file(), ownerId: "other" }, { ...file(), bookId: "other" }, { ...file(), entryIds: ["saved"] }, { ...file(), draftLink: { ...file().draftLink!, scope: "manual" } }], "u", "book", "photo")).toEqual([own]);
  });
  it("账单导入只映射实际成功的候选，排除未选、重复、跳过与失败", () => {
    const candidates = [{ id: "ok", line: 1, selected: true }, { id: "skip", line: 2, selected: true }, { id: "error", line: 3, selected: true }, { id: "unselected", line: 4, selected: false }, { id: "dup", line: 5, selected: true, identityDuplicate: true }] as import("@libellum/shared").BillImportCandidate[];
    const report = { ok: true, rowCount: 5, importedCount: 1, skippedCount: 3, skippedLines: [2], errors: [{ line: 3, column: null, message: "invalid" }] };
    expect(billAttachmentMapping(candidates, report)).toEqual({ ok: "ok" });
    expect(billAttachmentMapping(candidates, { ...report, ok: false })).toEqual({});
  });
  it("部分保存不上传，重试成功后仅关联确定的服务器账目 ID", () => {
    const partial = resolveAttachmentDraft(file(), { a: "entry-a", unrelated: "other" });
    expect(partial.entryIds).toEqual([]);
    expect(partial.draftLink?.resolved).toEqual({ a: "entry-a" });
    const completed = resolveAttachmentDraft(partial, { b: "entry-b" });
    expect(completed.entryIds).toEqual(["entry-a", "entry-b"]);
    expect(resolveAttachmentDraft(completed, { a: "different" })).toBe(completed);
  });
  it("新批次中内容相同的候选不能接管上批附件", () => {
    const previous = file(["batch-old:0"]);
    expect(resolveAttachmentDraft(previous, { "batch-new:0": "new-entry" }).entryIds).toEqual([]);
  });
  it("未选择、未保存和不在映射中的账目不会被关联", () => {
    expect(resolveAttachmentDraft(file([]), { a: "entry-a" }).entryIds).toEqual([]);
    expect(resolveAttachmentDraft(file(["a"]), { b: "entry-b" }).entryIds).toEqual([]);
    expect(resolveAttachmentDraft(file(["a"]), { a: "entry-a", b: "entry-b" }).entryIds).toEqual(["entry-a"]);
  });
  it("去除失败目标后允许保留已保存目标，且不会重复上传原件", () => {
    const partial = resolveAttachmentDraft(file(), { a: "entry-a" });
    const changed = { ...partial, draftLink: { ...partial.draftLink!, targets: [{ id: "a", label: "A" }] } };
    expect(resolveAttachmentDraft(changed, {}).entryIds).toEqual(["entry-a"]);
    expect(resolveAttachmentDraft(changed, {}).id).toBe("file");
  });
  it("每笔独立校验数量及总大小，共用文件只对每个目标计算一次", () => {
    const limits = { fileBytes: 5, entryFiles: 2, entryBytes: 8 };
    expect(captureAttachmentLimit([file(["a", "a"]), file(["a"])], limits)).toBe(true);
    expect(captureAttachmentLimit([file(["a"]), file(["a"]), file(["b"])], limits)).toBe(true);
    expect(captureAttachmentLimit([file(["a"]), file(["a"]), file(["a"])], limits)).toBe(false);
    expect(captureAttachmentLimit([file(["a"], 5), file(["a"])], limits)).toBe(false);
    expect(captureAttachmentLimit([file([], 6)], limits)).toBe(false);
  });
});
