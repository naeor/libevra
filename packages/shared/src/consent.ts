/**
 * Consent and major-announcement data shared by the API and the browser.
 *
 * ⚠️ **No production legal text is defined here.** The only document below is an explicitly marked
 * local test file used to exercise the confirmation flow. A real terms/privacy document must be
 * reviewed and added by the owner before it can become required in production. The API and UI
 * distinguish "the mechanism exists" from "a legally effective document has been published".
 */
export interface LegalDocument {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  /** One or two short sentences shown above the full file. */
  readonly summary: string;
  /** Visible paragraphs, rendered in order. */
  readonly paragraphs: readonly string[];
  /** Local test files never become required in a production build. */
  readonly testOnly: boolean;
  /** Only documents with this true are required before online use. */
  readonly requiresAcceptance: boolean;
}

export interface MajorAnnouncement {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly items: readonly string[];
  }[];
  /** ISO instant; a new account created later must not be shown this historical announcement. */
  readonly publishedAt: string;
  readonly testOnly: boolean;
}

/**
 * Local-only test agreement.
 *
 * It exists to prove the whole mechanism: required document, checkbox, server acceptance row,
 * refusal flow and public file access. It is not a terms of service and has no legal effect.
 */
export const TEST_LEGAL_DOCUMENT: LegalDocument = {
  id: "local-test-terms",
  version: "test-2026-10-18",
  title: "本地测试协议",
  summary: "这是用于验证协议确认流程的本地测试文件，不构成正式法律文件。",
  paragraphs: [
    "这是一份本地测试协议，仅用于验证 Libevra 的协议确认、同意记录和受限状态流程。",
    "它不是服务条款，也不是隐私政策；它不对任何人的权利义务产生法律效力。",
    "正式上线前，服务条款和隐私政策必须由所有者审阅并确认，不能使用本测试文件代替。",
  ],
  testOnly: true,
  requiresAcceptance: true,
};

/** Local-only major update used by the development environment to exercise the popup. */
export const TEST_MAJOR_ANNOUNCEMENT: MajorAnnouncement = {
  id: "local-test-major-2026-10",
  version: "1.13.09-test",
  title: "重要更新测试公告",
  summary: "这是一条本地测试重大更新，用于验证每个账号只提醒一次的跨设备确认流程。",
  sections: [
    {
      heading: "测试用途",
      items: [
        "这条公告只在本地开发环境出现，不会进入正式发布。",
        "确认后同一账号在另一台设备上不再自动弹出。",
      ],
    },
  ],
  // 2026-10-18 13:30 Asia/Shanghai. Accounts created after this instant do not need to see it.
  publishedAt: "2026-10-18T05:30:00.000Z",
  testOnly: true,
};

/**
 * The real 1.14.18 major update, published with the production release.
 *
 * Accounts created after the publication instant are intentionally excluded by the server; this
 * is a change notice for accounts that existed before it, not an onboarding message.
 */
export const RELEASE_MAJOR_ANNOUNCEMENT_1_14_18: MajorAnnouncement = {
  id: "major-1.14.18",
  version: "1.14.18",
  title: "Libevra 1.14.18",
  summary: "让账目流动，也让每一步更安心。",
  sections: [
    {
      heading: "账本之间，自由整理",
      items: [
        "现在可以将游客账本中的记录导入正式账本，也可以将符合条件的正式单人账本导入另一本单人账本。",
        "导入前可以选择目标账本、检查记录差异并处理冲突；原始账本不会因为导入而自动删除。",
      ],
    },
    {
      heading: "导入前，先确认",
      items: [
        "大量记录可以分批处理，导入任务也能在中断后恢复。",
        "导入完成后有 10 分钟决定是否确认；取消或超过确认时间，系统会尝试撤销本次任务的变更。",
        "在最终确认前，相关账本会暂时受到保护，避免其他操作干扰导入和撤销过程。",
      ],
    },
    {
      heading: "更清楚地处理重复记录",
      items: [
        "再次导入曾经处理过的数据时，可以识别已有来源记录，减少重复添加。",
        "来源记录发生变化时，可以在导入预览中选择保留已有内容，或按新的内容更新。",
      ],
    },
    {
      heading: "其他改进",
      items: [
        "优化了导入过程中的状态提示、错误处理和恢复能力。",
        "完善了账本及交易数据的保护措施。",
        "改进了 CSV 导入失败时的回滚处理，避免部分记录残留。",
        "保持邀请制注册，新账号仍需邀请码。",
      ],
    },
  ],
  // 2026-10-19 16:31:24 Asia/Shanghai, the actual 1.14.18 production release completion.
  publishedAt: "2026-10-19T08:31:24.000Z",
  testOnly: false,
};

/**
 * Documents that currently require acceptance.
 *
 * Test-only documents are returned only when the caller explicitly enables local test mode. A
 * production API passes false and therefore requires no unreviewed legal text.
 */
export function activeLegalDocuments(includeTest: boolean): readonly LegalDocument[] {
  return includeTest ? [TEST_LEGAL_DOCUMENT] : [];
}

export function activeMajorAnnouncements(includeTest: boolean): readonly MajorAnnouncement[] {
  const announcements: MajorAnnouncement[] = [RELEASE_MAJOR_ANNOUNCEMENT_1_14_18];
  if (includeTest) announcements.push(TEST_MAJOR_ANNOUNCEMENT);
  return announcements;
}

export function legalDocumentById(
  id: string,
  includeTest: boolean,
): LegalDocument | null {
  return activeLegalDocuments(includeTest).find((document) => document.id === id) ?? null;
}

export function majorAnnouncementById(
  id: string,
  includeTest: boolean,
): MajorAnnouncement | null {
  return activeMajorAnnouncements(includeTest).find((announcement) => announcement.id === id) ?? null;
}
