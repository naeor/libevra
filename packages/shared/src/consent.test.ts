import { describe, expect, it } from "vitest";

import {
  activeMajorAnnouncements,
  majorAnnouncementById,
  RELEASE_MAJOR_ANNOUNCEMENT_1_14_18,
  RELEASE_MAJOR_ANNOUNCEMENT_1_15_00,
} from "./consent.js";

/**
 * 生产环境「重要更新」弹窗的数据（S15 发布，2026-10-21）。
 *
 * ⚠️ 这里断言的是**正式公告**，不是本地测试公告：所有者的账号是老账号，服务器策略会在
 * 「公告发布时刻晚于账号创建时刻且尚未确认」时把它作为弹窗返回。测试公告只允许在
 * `includeTest=true` 时出现，不能混进生产列表。
 */
describe("major announcements (production policy)", () => {
  it("ships the 1.15.00 update as a non-test major announcement", () => {
    const entry = majorAnnouncementById("major-1.15.00", false);

    expect(entry).not.toBeNull();
    expect(entry?.version).toBe("1.15.00");
    expect(entry?.testOnly).toBe(false);
    expect(entry?.title).toBe("Libevra 1.15.00");
    expect(entry?.summary).toBe("记录更顺手，识别更完整。");
    expect(entry?.sections.map((section) => section.heading)).toEqual([
      "手动记账，更顺手",
      "一张截图，识别多笔",
      "批量核对，一次确认",
      "账本与日常操作",
      "界面与可读性",
    ]);
  });

  it("keeps the production policy free of test notices and newer than 1.14.18", () => {
    const production = activeMajorAnnouncements(false);

    expect(production.every((entry) => entry.testOnly === false)).toBe(true);
    expect(production.some((entry) => entry.id === RELEASE_MAJOR_ANNOUNCEMENT_1_14_18.id)).toBe(true);

    // 服务器按 publishedAt 取最新一条作为待确认公告；1.15.00 必须比 1.14.18 新。
    const newest = [...production].sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt),
    )[0];
    expect(newest?.id).toBe(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00.id);
    expect(
      new Date(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00.publishedAt).getTime(),
    ).toBeGreaterThan(new Date(RELEASE_MAJOR_ANNOUNCEMENT_1_14_18.publishedAt).getTime());
  });

  it("includes the local test notice only when explicitly enabled", () => {
    expect(activeMajorAnnouncements(false).some((entry) => entry.testOnly)).toBe(false);
    expect(activeMajorAnnouncements(true).some((entry) => entry.testOnly)).toBe(true);
  });
});
