import { describe, expect, it } from "vitest";
import { AVATAR_IDS, APPROVED_AVATAR_IDS, SELECTABLE_AVATAR_IDS, avatarIdSchema, updateProfileRequestSchema } from "./profile.js";

describe("资料契约", () => {
  it("26 个稳定身份兼容旧选择，新增四款经典且保留两款特典", () => {
    expect(new Set(AVATAR_IDS).size).toBe(26);
    expect(APPROVED_AVATAR_IDS).toEqual(["sprout", "sun", "moon", "star", "wave", "coffee", "jade", "ghost", "ingot", "breakfast-sun"]);
    expect(SELECTABLE_AVATAR_IDS).toEqual(["flower", ...APPROVED_AVATAR_IDS, "daoxuan-special", "descent-special"]);
    expect(AVATAR_IDS).toEqual(expect.arrayContaining(["leaf", "boat", "cat"]));
    for (const id of AVATAR_IDS) expect(avatarIdSchema.parse(id)).toBe(id);
    expect(avatarIdSchema.safeParse("https://example.test/avatar").success).toBe(false);
  });
  it("只接收一个字段及旧值，不允许夹带身份或权限字段", () => {
    expect(updateProfileRequestSchema.safeParse({ field: "avatarId", value: "cat", previousValue: "flower" }).success).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ field: "username", value: "hello", previousValue: "old", id: "other" }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ field: "username", value: "hello" }).success).toBe(false);
  });
});
