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
 * The real 1.15.00 major update, published with the S15 production release.
 *
 * ⚠️ **The user-visible facts must stay identical to the same version's entry in
 * `apps/web/src/lib/updateAnnouncements.ts`**: the popup is driven by this server-side list, while
 * the update history/detail pages are driven by the web bundle. One version, one story; the two
 * files are the two halves of the same announcement.
 *
 * Accounts created after the publication instant are intentionally excluded by the server; this is
 * a change notice for accounts that existed before it, not an onboarding message.
 */
export const RELEASE_MAJOR_ANNOUNCEMENT_1_15_00: MajorAnnouncement = {
  id: "major-1.15.00",
  version: "1.15.00",
  title: "Libevra 1.15.00",
  summary: "记录更顺手，识别更完整。",
  sections: [
    {
      heading: "手动记账，更顺手",
      items: [
        "重新整理了手动记账页面的字段顺序，金额、分类等常用内容更集中。",
        "快捷金额默认收起，需要时展开；新增「沿用上一笔」，可沿用上一笔的分类、支付方式、币种与标签。",
        "金额输入框右侧可直接切换币种，保存区域与底部导航衔接更自然。",
      ],
    },
    {
      heading: "一张截图，识别多笔",
      items: [
        "图片识别现在可以处理交易列表、银行流水等多笔页面，不再局限于单笔详情。",
        "支持跨图片识别重复项提示；无法确定页面类型时，会请你选择按单笔或多笔处理。",
        "识别结果仍以待核对草稿呈现，确认前不会写入账本。",
      ],
    },
    {
      heading: "批量核对，一次确认",
      items: [
        "新增批量核对概览，可按待核对、疑似重复等状态筛选，并进入单笔详情修改。",
        "核对完成后统一确认导入，系统逐条写入并给出结果汇总。",
        "导入完成页会显示本次会话的累计结果，可继续识别下一批；未确定的字段仍会明确标注。",
      ],
    },
    {
      heading: "账本与日常操作",
      items: [
        "账本导入的来源与目标改为页面内选择列表。",
        "修复了从账本详情进入设置、再进入导入后返回时的页面循环。",
        "明细页支持批量选择、批量修改与删除；离线删除状态与刷新反馈更准确。",
      ],
    },
    {
      heading: "界面与可读性",
      items: [
        "统一了展开箭头、金额字号与对齐等展示规则。",
        "修复了部分输入控件字号被全局样式覆盖的问题。",
        "保持邀请制注册，新账号仍需邀请码。",
      ],
    },
  ],
  // 2026-10-21 09:21:05 CST, the actual 1.15.00 production deployment completion (api/web healthy).
  publishedAt: "2026-10-21T01:21:05.000Z",
  testOnly: false,
};

/**
 * The real 1.17.11 major update: the first production release of the S17 analysis workbench line,
 * also carrying the Halloween limited avatar.
 *
 * ⚠️ **The user-visible facts must stay identical to the same version's entry in
 * `apps/web/src/lib/updateAnnouncements.ts`**: the popup is driven by this server-side list, while
 * the update history/detail pages are driven by the web bundle. One version, one story; the two
 * files are the two halves of the same announcement.
 *
 * Accounts created after the publication instant are intentionally excluded by the server; this is
 * a change notice for accounts that existed before it, not an onboarding message.
 */
export const RELEASE_MAJOR_ANNOUNCEMENT_1_17_11: MajorAnnouncement = {
  id: "major-1.17.11",
  version: "1.17.11",
  title: "Libevra 1.17.11",
  summary: "把每一笔账，变成你自己的分析工作台。",
  sections: [
    {
      heading: "分析工作台正式登场",
      items: [
        "「分析」页升级为可自定义的财务工作台：38 张分析卡片全部接通真实数据，浏览、筛选、编辑在同一页切换。",
        "卡片可以拖动、换位、调整尺寸、复制与删除，布局按账号保存在本机，刷新后仍然保持。",
        "每张卡片都有对应的数据口径说明，点开可进入详情页；返回时恢复原来的滚动位置。",
      ],
    },
    {
      heading: "筛选、自定义与组合卡片",
      items: [
        "新增分类、支付方式、标签三个可多选筛选维度，与时间、币种一起作用于摘要、全部卡片、固定窗口卡与上期比较；筛选条件写在地址栏，可分享、可刷新、可直达。",
        "自定义卡片可选 81 / 84 项指标与 31 个图表家族，并新增组合卡片：多个数字与图表可同卡排列，按真实格子像素预览「放得下 / 放不下」，放不下的内容点开完整查看。",
        "综合折算覆盖全部 38 张卡片；缺少汇率时合计只给已折算小计，笔数与天数照常计数，比率与极值如实说明不确定性，趋势与热力图把未知时段标为「未知」而不是 0。",
      ],
    },
    {
      heading: "离线、细节与万圣限定头像",
      items: [
        "离线历史镜像单月读取上限从 4,000 笔提高到约 50,000 笔，并区分「已取完」与「被截断」，部分月份不再被当成整月写入本地账本。",
        "修正「有支出的分类数」单位、金额缩字号截断、窄屏图例与数字列、比率负数四舍五入、右列组合卡片保存失败等问题；日常启动脚本固定打开 http://localhost:5173，不再静默漂移到 5174。",
        "特典系列新增「万圣」限定头像：每年账户当地 10 月 31 日登录即可领取并永久持有，不开放补领；未解锁时在头像选择页显示锁定态。",
      ],
    },
    {
      heading: "升级须知",
      items: [
        "本次更新包含第 61 号数据库迁移：只扩充用户头像选择、解锁记录与奖励通知的 CHECK 白名单，不改动表结构、账目、账本或成员权限，升级时自动完成。",
        "约 50,000 笔 / 月是临时提高的离线读取上限，不是永久规格；某月超过上限会显式标记「未完整」，依赖该月的统计也会标记来源不完整。",
        "综合折算的逐笔条数仍受 50,000 保护，超限时依赖逐笔数据的卡片会明确说明、绝不截断；S17-C 的 P05 / P07 / P21、跨设备同步（W6）与 S18 全站自适应不在本版本内。",
        "旧版本客户端遇到 halloween-special 会安全回退显示为「小花」，不会报错也不会丢数据；升级后刷新页面即可加载新素材。发布过程会短暂重启服务，已保存数据不受影响。",
      ],
    },
  ],
  // 2026-10-28 14:00 CST, before the planned 1.17.11 production deployment; accounts created after
  // this instant (including any account created by the new build) are onboarding, not change notices.
  publishedAt: "2026-10-28T06:00:00.000Z",
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
  const announcements: MajorAnnouncement[] = [
    RELEASE_MAJOR_ANNOUNCEMENT_1_14_18,
    RELEASE_MAJOR_ANNOUNCEMENT_1_15_00,
    RELEASE_MAJOR_ANNOUNCEMENT_1_17_11,
  ];
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
