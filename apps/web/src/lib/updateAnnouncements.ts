/**
 * Version announcements bundled with the application.
 *
 * ⚠️ **Only actual production releases belong here.** A version that is still being developed
 * must not appear as released, and a release date must never be guessed. The list is deliberately
 * local and static for now: there is no server-side announcement service or CMS. The major-update
 * popup itself is driven by the separate server policy (`packages/shared/src/consent.ts`) and the
 * existing account-level acknowledgement table; this file only provides the full history/detail
 * pages, so the two sources must keep the same user-visible facts.
 */
export interface UpdateAnnouncement {
  /** The exact version users saw in production, e.g. "1.13.07". */
  readonly version: string;
  /** Publication date, or null while a version is not released yet. */
  readonly releasedAt: string | null;
  readonly status: "released" | "development";
  readonly title: string;
  /** One or two sentences for the home card and the history row. */
  readonly summary: string;
  /** Editorial revision date; never used as a release date or acknowledgement identity. */
  readonly revisedAt?: string;
  /** Opening paragraphs shown verbatim above the grouped sections. */
  readonly intro?: readonly string[];
  /** Full announcement, grouped under short headings. */
  readonly sections: readonly {
    readonly heading: string;
    readonly items: readonly string[];
  }[];
  /** Closing paragraphs shown verbatim after the grouped sections. */
  readonly closing?: readonly string[];
  /** Marks a large release whose popup is configured separately by the server policy. */
  readonly major: boolean;
}

/**
 * 1.15.05 is the paste-entry + voice-parsing + five-way shortcut-menu release
 * (2026-10-23), a normal (non-popup) announcement. 1.15.04 is the
 * old-major-announcement display fix (2026-10-22), also normal (non-popup).
 * 1.15.03 is the S15-E + 账单导入 V2 production release (2026-10-22), also normal
 * (non-popup). 1.15.00 is the S15 production release (2026-10-21).
 * 1.14.20 is the OCR production patch (2026-10-20). 1.14.18 is the S14 production
 * release (2026-10-19). 1.13.15 is the S13-G/H/I release; 1.13.09 is the S13-F
 * release; 1.13.08 was a production patch (card layout) and 1.13.07 was the full
 * S13-E release.
 */
const ALL_ANNOUNCEMENTS: readonly UpdateAnnouncement[] = [
  {
    "version": "1.16.03",
    "releasedAt": "2026-10-23",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "页面统一与文案优化",
    "summary": "统一二级页面布局与导航，整理全站文案表述，并修正若干高风险提示。",
    "sections": [
      {
        "heading": "调整及优化",
        "items": [
          "二级与三级页面统一了标题区、返回和滚动行为与列表间距；底部导航、中央记账入口和原有路由保持不变。",
          "删除与恢复、导入、OCR、账号数据等页面中容易误解的说明已改写为更直接的表述，技术术语和开发者提示改为用户能理解的说明。",
          "「软件更新」保留每个历史版本的原始发布日期、版本号和重大更新身份，按整理后的内容呈现；旧公告不会被当作新发布再次通知。"
        ]
      },
      {
        "heading": "问题修复",
        "items": [
          "修复关于页中不准确的存储位置与币种小数位说明，以及法律页仍把已上线产品写为未上线的状态描述。",
          "修复账本导入中可能被理解为「只新增、不删除」的绝对表述，明确来源账本记录可能被跳过、移除或删除。",
          "修复历史变更记录中部分说明显示英文键名或多余空格的问题。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "历史金额变更的展示仍按现有版本策略暂缓调整，不会用当前币种猜测历史金额；当前账目的金额与币种不受影响。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.15.05",
    "releasedAt": "2026-10-23",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "粘贴识别与语音解析",
    "summary": "新增粘贴文字识别，支持修改语音转写后重新解析，并调整五种记账入口的窄屏名称。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "新增「粘贴识别」页面，可识别文字中的金额、日期、币种、分类等信息，进入核对页后再保存。",
          "可拆分的多笔文字分别生成候选项；无法可靠拆分时，会提示分开粘贴。"
        ]
      },
      {
        "heading": "调整及优化",
        "items": [
          "语音与粘贴使用同一套金额、日期、商户和分类解析规则。语音转写文字可手动修改，修改后重新解析，无需重新录音。",
          "中央记账菜单提供粘贴、语音、手动、拍照、导入五种方式，手动记账保持居中；窄屏显示简短名称。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "识别结果需核对后保存；语音结果仍可能受环境、语速和口音影响。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.15.04",
    "releasedAt": "2026-10-22",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "旧版重大更新提示修复",
    "summary": "升级后不再显示早于当前运行版本的重大更新提示，历史公告仍可主动查看。",
    "sections": [
      {
        "heading": "问题修复",
        "items": [
          "修复应用升级后仍显示旧版重大更新提示的问题：早于当前运行版本的重大公告不再弹出。",
          "历史公告继续保留在「软件更新」中；同一账号的确认记录不变，不影响账目数据。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.15.03",
    "releasedAt": "2026-10-22",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "重复检测与账单导入",
    "summary": "统一各记账入口的重复提醒，新增全账本检查，并支持微信、支付宝、BOA 与 Libevra 账单文件核对导入。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "可主动检查整本账本中的疑似重复账目，查看进度并随时取消。检查仅列出候选项，不自动删除、合并或覆盖账目。",
          "可确认两笔账目「不是同一笔」，并按账本保存该判断；支持查看和撤销，关键字段变化后该判断会失效。",
          "账单导入支持微信 XLSX、支付宝 CSV、BOA PDF 和 Libevra CSV，按文件内容识别来源，并提供统一预览与核对流程。"
        ]
      },
      {
        "heading": "调整及优化",
        "items": [
          "手动、语音、图片识别与账单导入使用同一套重复判断规则。疑似重复由用户决定是否保留，不自动取消勾选或删除。",
          "在「设置 → 记账偏好」中可开关重复提醒、选择匹配字段并调整时间范围，默认 1 分钟，可设为 1 分钟至 30 天。各账本独立检查。",
          "账单核对时可修改金额、日期、时间、收支类型、分类、支付方式、备注和标签；修改或重新勾选后，需重新检查再提交。",
          "重复导入相同来源记录时会跳过已存在项；内容相近但来源不同的记录只提示疑似重复。"
        ]
      },
      {
        "heading": "问题修复",
        "items": [
          "修复同时确认同一组「不是同一笔」判断时可能失败的问题。",
          "修复账单核对后可以绕过重新检查、直接提交过期核对结果的问题。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "BOA PDF 仅支持含文本层的文件，不支持扫描版；文件中的日期精度不足、字段缺失或汇总不一致时会提示核对。",
          "重复检测设置保存在当前浏览器，不跨设备同步。关闭提醒不影响防止重复提交、识别相同来源、权限检查和离线同步。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.15.00",
    "releasedAt": "2026-10-21",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "多笔图片识别与记账操作调整",
    "summary": "图片识别支持一图多笔与批量核对，手动记账新增沿用上一笔，并调整明细批量操作和页面返回。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "图片识别支持交易列表、银行流水等多笔页面，以及跨图片的疑似重复提示；无法确定页面类型时，可选择按单笔或多笔处理。",
          "新增批量识别概览，可按待核对、疑似重复等状态筛选，进入单笔详情修改后统一确认导入。",
          "手动记账新增「沿用上一笔」，可沿用分类、支付方式、币种与标签。",
          "明细页支持批量选择、修改与删除账目。"
        ]
      },
      {
        "heading": "调整及优化",
        "items": [
          "调整手动记账字段顺序，快捷金额默认收起，币种可在金额框右侧切换。",
          "导入完成页显示本次会话累计结果，并可继续识别下一批；未确定字段保持标注。",
          "账本导入的来源与目标改为页面内选择列表，统一展开箭头、金额字号及对齐。"
        ]
      },
      {
        "heading": "问题修复",
        "items": [
          "修复从账本详情进入设置和导入后，返回时可能陷入页面循环的问题。",
          "调整离线删除状态和刷新反馈，修复部分输入控件字号被全局样式覆盖的问题。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
        "识别结果在确认前不会入账，确认后逐笔写入并显示结果。跨图片重复提示仅针对本次识别，不检查整本账本。",
          "注册仍采用邀请制，新账号需要邀请码。"
        ]
      }
    ],
    "major": true
  },
  {
    "version": "1.14.20",
    "releasedAt": "2026-10-20",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "修复图片识别启动失败",
    "summary": "修复服务器图片识别服务无法启动的问题，并在启动异常时及时返回失败提示。",
    "sections": [
      {
        "heading": "问题修复",
        "items": [
          "修复服务器缺少图片识别所需组件，导致付款截图识别失败的问题。",
          "识别服务在准备完成前异常退出时，立即返回失败提示，不再等待原有的 60 秒启动超时；失败后可重新尝试启动。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "本次未调整语音识别模型，不包含语音提速更新。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.14.18",
    "releasedAt": "2026-10-19",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "账本导入、撤销与来源管理",
    "summary": "支持游客账本及符合条件的单人账本导入，新增分批任务、确认前撤销和来源记录变化核对。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "可将游客账本导入正式账本，或将符合条件的正式单人账本导入另一本单人账本；正式来源与目标须符合单人账本条件，导入前需先创建并选择目标账本。",
          "导入前可预览差异，分别选择导入或跳过来源账目、保留或移除目标账目；来源账本不会自动删除。",
          "大量账目由服务端分批导入，中断后可查看任务并继续；再次导入可识别已处理来源，并核对来源记录的变化。",
          "导入确认完成后，可另行检查已迁入的游客记录并手动清理，或按账本生命周期规则弃置正式来源。未迁入的记录不会因游客清理被删除。"
        ]
      },
      {
        "heading": "调整及优化",
        "items": [
          "分批写入完成后有 10 分钟确认时间；执行撤销或超过确认时限时，系统会尝试撤回本次任务带来的变更。最终确认前相关账本暂停编辑。",
          "来源记录变化时，可选择保留目标内容，或在允许更新的条件下将变化写入目标账目。"
        ]
      },
      {
        "heading": "问题修复",
        "items": [
          "修复 CSV/XLSX 文件导入失败时，新建标签可能未随账目一同撤回的问题。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "账本导入与 CSV/XLSX 文件导入是不同流程，后者不提供上述 10 分钟确认和撤销机制。",
          "撤销失败时账本可能继续暂停编辑，需先处理失败状态。正式来源弃置及恢复遵守原有恢复期限；注册仍采用邀请制。"
        ]
      }
    ],
    "major": true
  },
  {
    "version": "1.13.15",
    "releasedAt": "2026-10-19",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "账号注销与账本恢复",
    "summary": "新增账号注销、账本归档与恢复申请流程，并记录关键操作以辅助历史备份恢复校验。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "新增账号注销和服务器数据删除流程，确认前展示各账本的处理范围。共享账本与单人账本按各自规则处理。",
          "新增账本归档、期限内自助恢复及人工恢复申请流程；注销账号后的账本恢复凭证与账号恢复码分别处理。",
          "新增重大更新提示与协议确认机制。普通版本公告不要求确认；重大公告的确认按账号保存。",
          "新增关键操作记录机制，降低恢复历史备份时已删除账本、账号状态或权限变更意外失效的风险。"
        ]
      },
      {
        "heading": "调整及优化",
        "items": [
          "备份恢复增加关键状态及完整性校验，并增加相关异常监测。",
          "公告详情增加上一版本、下一版本导航，保留历史公告入口。"
        ]
      },
      {
        "heading": "注意事项",
        "items": [
          "账本恢复受恢复期限及现有流程限制，恢复凭证不能用于恢复已注销账号。协议确认机制上线不表示正式隐私政策或使用条款已经提供。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.13.09",
    "releasedAt": "2026-10-18",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "软件更新中心与公告历史",
    "summary": "软件更新页展示运行版本与最近公告，新增历史列表、公告详情和运行信息入口。",
    "sections": [
      {
        "heading": "新增功能",
        "items": [
          "软件更新首页显示当前运行版本和最近一次正式更新公告。",
          "新增公告历史列表和单个版本详情，支持直接访问和刷新。",
          "右上角「更多」提供复制版本信息与查看运行信息入口。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.13.08",
    "releasedAt": "2026-10-18",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "当前账本卡片布局调整",
    "summary": "调整单人及协作账本的切换区域，并让较长的账本名称换行显示。",
    "sections": [
      {
        "heading": "调整及优化",
        "items": [
          "单人账本卡片改为左右布局，切换账本按钮位于右侧。",
          "协作账本的切换操作改为紧凑横栏，减少占用高度。",
          "较长的账本名称改为换行显示，不再省略。"
        ]
      }
    ],
    "major": false
  },
  {
    "version": "1.13.07",
    "releasedAt": "2026-10-18",
    "revisedAt": "2026-10-23",
    "status": "released",
    "title": "账本设置与协作管理",
    "summary": "重新组织账本详情和设置，按账本管理分类、标签与支付方式，并明确共享账本的离线查看范围。",
    "sections": [
      {
        "heading": "调整及优化",
        "items": [
          "重新整理账号、设置和账本详情的职责，分类、标签与支付方式在各账本中独立管理。",
          "个人账本保留离线记账；共享账本离线时只读，已有待同步改动保留，联网后再处理。",
          "调整账本成员权限、编辑历史及管理操作的展示。"
        ]
      }
    ],
    "major": false
  }
];

function compareVersionParts(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const l = leftParts[index] ?? 0;
    const r = rightParts[index] ?? 0;
    if (l !== r) return l - r;
  }

  return 0;
}

/** The history page shows this many releases before offering the older ones. */
export const ANNOUNCEMENT_PAGE_SIZE = 20;

/** Released announcements, newest first. The page owns how many are initially shown. */
export function releasedAnnouncements(
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): readonly UpdateAnnouncement[] {
  return all
    .filter(
      (announcement): announcement is UpdateAnnouncement & { releasedAt: string } =>
        announcement.status === "released" && announcement.releasedAt !== null,
    )
    .slice()
    .sort((left, right) => {
      const byDate = right.releasedAt.localeCompare(left.releasedAt);
      return byDate === 0 ? compareVersionParts(right.version, left.version) : byDate;
    });
}

export function latestReleasedAnnouncement(): UpdateAnnouncement | null {
  return releasedAnnouncements()[0] ?? null;
}

/**
 * The newest announcement applicable to a running build. An old client must not claim to know
 * about a version newer than itself; the caller pairs this with an explicit "no live check"
 * explanation on the screen.
 */
export function latestApplicableAnnouncement(
  currentVersion: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): UpdateAnnouncement | null {
  return (
    releasedAnnouncements(all).find(
      (announcement) => compareVersionParts(currentVersion, announcement.version) >= 0,
    ) ?? null
  );
}

export function releasedAnnouncementByVersion(
  version: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): UpdateAnnouncement | null {
  return (
    releasedAnnouncements(all).find((announcement) => announcement.version === version) ?? null
  );
}

/**
 * Neighbours for the detail page's version navigation.
 *
 * "older" is the previous release in time; "newer" is the next one. Both are
 * released announcements only, so the links can never lead to a development
 * placeholder or invent a version that users have not received.
 */
export function adjacentReleasedAnnouncements(
  version: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): {
  readonly older: UpdateAnnouncement | null;
  readonly newer: UpdateAnnouncement | null;
} {
  const releases = releasedAnnouncements(all);
  const index = releases.findIndex((announcement) => announcement.version === version);
  if (index < 0) return { older: null, newer: null };

  return {
    older: releases[index + 1] ?? null,
    newer: index > 0 ? releases[index - 1]! : null,
  };
}

/** Stable for a Chinese reader, without inventing a time or timezone. */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function compareVersions(left: string, right: string): number {
  return compareVersionParts(left, right);
}

/** Exported for tests; not a hook or a server query. */
export function hasNewerReleasedVersion(
  currentVersion: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): boolean {
  const latest = releasedAnnouncements(all)[0] ?? null;
  return latest !== null && compareVersionParts(latest.version, currentVersion) > 0;
}
