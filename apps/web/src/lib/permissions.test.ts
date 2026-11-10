import { describe, expect, it } from "vitest";
import { canEditAllRole, canEditEntryAs, canRecordRole, invitableRoles } from "./permissions.js";

describe("账本权限分级在界面上的读法（1.19.56）", () => {
  it("只读 → 记账 → 编辑全部，旧值 owner 同编辑全部", () => {
    expect([canRecordRole("viewer"), canRecordRole("recorder"), canRecordRole("editor"), canRecordRole("owner")]).toEqual([false, true, true, true]);
    expect([canEditAllRole("viewer"), canEditAllRole("recorder"), canEditAllRole("editor"), canEditAllRole("owner")]).toEqual([false, false, true, true]);
    expect(canRecordRole(undefined)).toBe(false);
  });

  it("记账只能改自己记的账目；不知道记录人时不显示修改", () => {
    expect(canEditEntryAs("recorder", "me", "me")).toBe(true);
    expect(canEditEntryAs("recorder", "me", "dad")).toBe(false);
    expect(canEditEntryAs("recorder", "me", undefined)).toBe(false);
    expect(canEditEntryAs("viewer", "me", "me")).toBe(false);
    expect(canEditEntryAs("editor", "me", "dad")).toBe(true);
  });

  it("邀请时只能选不高于自己的权限", () => {
    expect(invitableRoles("viewer")).toEqual(["viewer"]);
    expect(invitableRoles("recorder")).toEqual(["viewer", "recorder"]);
    expect(invitableRoles("editor")).toEqual(["viewer", "recorder", "editor"]);
  });
});
