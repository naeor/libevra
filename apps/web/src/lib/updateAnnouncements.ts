/**
 * Version announcements bundled with the application.
 *
 * ⚠️ **Only actual production releases belong here.** A version that is still being developed
 * must not appear as released, and a release date must never be guessed. The list is deliberately
 * local and static for now: there is no server-side announcement service or CMS. The major-update
 * popup itself is driven by the separate server policy (`packages/shared/src/consent.ts`) and the
 * existing account-level acknowledgement table; this file only provides the full history/detail
 * pages, so the two sources must keep the same user-visible facts.
 *
 * i18n-ignore-file：本文件是更新公告的中文**内容数据**（源语言原文）。英文整篇译文在
 * `i18n/content/updateAnnouncements.en.ts`，显示时由 `localizeUpdateAnnouncement()` 替换。
 */
import { currentLocale, isChineseLocale } from "../i18n/index.js";

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
 * 1.16.21 is the exchange-rate conversion + cross-currency analysis release
 * (2026-10-26), a normal (non-popup) announcement.
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
  // 1.16.22 随本次授权发布：第二批四款经典头像，普通公告，不增加确认弹窗。
  {
    version: "1.16.22",
    releasedAt: "2026-10-26",
    status: "released",
    title: "四款新头像加入经典系列",
    summary: "经典系列新增玉净、幽幽、元宝和「太阳」，所有用户均可直接选择。",
    sections: [
      {
        heading: "新增功能",
        items: [
          "玉净：修长清雅的玉净瓶，底部带着一圈轻轻的水纹。题注：甘露妙法，杨枝玉净。",
          "幽幽：软乎乎、略带漂浮感的小幽灵。题注：呜呜呜……别被吓到哦～",
          "元宝：圆润饱满、两侧柔和上翘。题注：摸摸元宝，招财进宝。",
          "「太阳」：一枚自然摊开的煎蛋，名字中的「」也是正式名称的一部分。题注：吃下一枚“太阳”，一整天都会更温暖。",
        ],
      },
      {
        heading: "注意事项",
        items: [
          "在「我的 → 个人资料」中进入头像选择，选中喜欢的头像并保存即可使用。四款都属于经典系列，无须额外解锁。",
          "新头像支持七种主题、浅色与深色外观，并配有中英文名称和题注；原有经典头像、特典头像和解锁记录保留。",
        ],
      },
    ],
    major: false,
  },
  // 1.16.21 正式发布（2026-10-26）：汇率折算模式、跨币种统计与离线保存修复。
  {
    version: "1.16.21",
    releasedAt: "2026-10-26",
    status: "released",
    title: "汇率折算与跨币种统计",
    summary:
      "新增可选的汇率折算模式：把不同币种的账目按交易日期折算成默认币种查看，分析与详情保留原币；另修复个人账本离线新增账目可能停在保存中的问题。",
    sections: [
      {
        heading: "新增功能",
        items: [
          "新增「汇率折算模式」，默认关闭。在「设置 → 显示与数据 → 汇率折算」中开启后，明细会同时显示折算金额与原币金额；分析新增综合视图，把不同币种按默认货币汇总，也可以随时切回分币种分析。",
          "折算使用账目交易日期对应的历史参考汇率（来源 ECB，经 Frankfurter 获取）；周末与节假日自动回退到最近可用日期，详情里会写明交易日期、实际参考日、来源与使用的汇率。",
          "汇率折算按账号保存在当前设备，切换账号、账本或统计货币时互不影响；只改变本机显示，其他成员看到的数据和权限不变。"
        ]
      },
      {
        heading: "调整及优化",
        items: [
          "账目、编辑、导出以及共享账本里保存的金额始终是原始币种与原始金额；折算结果只用于查看与统计，不会写回任何一条记录。",
          "缺汇率、离线或本机保存的时段不完整时，统计会明确标注为不完整并给出可定位的账目，不显示可能误导的百分比；成功折算的部分单独给出小计。",
          "设置首页与「显示与数据」中的入口文案随汇率功能同步整理，中英文保持一致。"
        ]
      },
      {
        heading: "问题修复",
        items: [
          "修复个人账本在离线或网络不稳定时，新增账目可能因重复检测等待联网而一直停在保存中的问题；现在先在本机完成检测与保存，联网后再同步。"
        ]
      },
      {
        heading: "注意事项",
        items: [
          "本次更新包含第 59 号数据库迁移，只新增公共参考汇率缓存表，不改动账目、账本与成员权限；升级时自动完成。",
          "汇率折算默认关闭，升级后原有页面与数据保持不变；开启后才显示折算金额。",
          "参考汇率用于查看与统计，实际结算金额仍以银行或支付渠道的成交价为准。"
        ]
      }
    ],
    major: false
  },
  // 1.16.18 正式发布（2026-10-26）：品牌标语、留言引用与头像页优化。
  {
    version: "1.16.18",
    releasedAt: "2026-10-26",
    status: "released",
    title: "品牌标语更新、留言引用与头像页优化",
    summary:
      "统一品牌主标语为「记账，按你的方式」；共享账本留言可以引用一笔账目或一次修改，也可以直接从记账成功页留言；头像选择页与留言页的多处细节同步优化。",
    sections: [
      {
        heading: "新增功能",
        items: [
          "共享账本留言现在可以「关于」一笔账目或一次修改：在留言输入框左侧轻点引用按钮，从最近账目与修改历史里选一条；也可以从记账成功页引用刚保存的这笔账。引用是可选的，不选择也能像以前一样直接留言。"
        ]
      },
      {
        heading: "调整及优化",
        items: [
          "品牌主标语统一为「记账，按你的方式」，首页开场与外观预览同步更新。",
          "记账成功页的留言入口移到成功信息区，改成低调的「就这笔留言」胶囊；点击会打开留言面板并自动引用这一笔，不会自动发送空留言。",
          "引用图标改为跟随主题色的浅色圆与白色上引号；引用选择面板与留言面板从下往上展开、从上往下收回。",
          "头像选择页的预览文字与头像统一居中，题注按宽度自然换行；特典头像按解锁状态排序，未解锁的头像降低饱和度并加小锁标记；底部保存栏避开手机底部安全区。",
          "留言页改为按时间从上往下阅读，最新的一条在最下面，进入时自动停在最下方；协作页的留言卡片显示最新两条。",
          "中英文文案同步维护，引用卡片里的分类名按界面语言显示。"
        ]
      },
      {
        heading: "问题修复",
        items: [
          "修复升级后打开「协作」页或留言页偶尔出现「页面无法显示」的问题：旧版本缓存的留言缺少引用字段；升级后会丢弃旧形状的缓存，并把缺失字段按无引用处理。",
          "修复引用按钮、输入框与发送按钮高度不一致、底边不齐的问题。",
          "修复协作页留言卡片显示最早两条、而不是最新两条留言的问题。"
        ]
      },
      {
        heading: "注意事项",
        items: [
          "本次更新包含第 58 号数据库迁移，只新增可空字段并校验引用种类，旧留言与账本数据保持不变；升级时自动完成。",
          "升级后首次打开页面会重新加载本机的查询缓存；已登录状态与账本数据不受影响。",
          "未升级的客户端看到带引用的留言时会按普通留言显示，引用卡片需要刷新到新版本后可见。"
        ]
      }
    ],
    major: false
  },
  // 1.16.16 正式发布（2026-10-25）：深链返回修复与文案微调。
  {
    version: "1.16.16",
    releasedAt: "2026-10-25",
    status: "released",
    title: "深链返回修复与文案微调",
    summary: "修复从分享链接、通知或刷新后进入页面时返回会在两屏之间来回跳动的问题，并补充软件更新入口的提示文案。",
    sections: [
      {
        heading: "问题修复",
        items: [
          "修复从分享链接、通知或刷新后直接打开二级页面时，连续返回可能在两个页面之间来回跳动的问题；现在第一次返回会直接回到上级页面，不再压入多余的历史记录。"
        ]
      },
      {
        heading: "调整及优化",
        items: ["「我的 → 软件更新」的版本提示现在会说明可以点击查看更新记录。"]
      },
      {
        heading: "注意事项",
        items: ["本次为补丁更新，不涉及数据库或迁移；已登录的账号与账本数据不受影响。"]
      }
    ],
    major: false
  },
  // 1.16.15 正式发布（2026-10-25）：S16 全量候选上线。
  {
    version: "1.16.15",
    releasedAt: "2026-10-25",
    status: "released",
    title: "中英双语、系统头像与纪念奖励",
    summary: "新增中英双语界面、九款系统头像与特典头像奖励，并改进设置体验与离线提示。",
    sections: [
      {
        heading: "新增功能",
        items: [
          "界面支持中文与 English：在「设置 → 显示与数据 → 语言」中选择跟随系统、中文或 English，切换立即生效，日期与数字格式随语言调整。",
          "新增九款系统头像与「经典系列 / 特典系列」分组；每款头像有一句题注，切换预览时即时更新。",
          "特典头像改为纪念奖励：首次登录后自动获得「降临」；在每年 11 月第三个周四（世界哲学日）按账号时区登录可获得「倒悬」。奖励由服务器自动发放，永久保留，可在头像页查看解锁日期与创作注记。"
        ]
      },
      {
        heading: "调整及优化",
        items: [
          "离线状态下修改记账偏好会立即提示无法同步，不再静默等待网络恢复。",
          "「清除本机全部数据」现在也覆盖语言与主题偏好；切换账号、注销或删除账号时会清理该账号的设备级残留。",
          "开启「减少动态效果」后，骨架屏与按钮加载动画不再脉冲或旋转。",
          "统一了文字层级与间距，并修正部分图表说明文字的行高。"
        ]
      },
      {
        heading: "问题修复",
        items: [
          "修复新建或切换账本后显示其他账本本机记录的问题；本次包含与 1.16.09 相同的账本数据隔离修复。",
          "修复切换账本期间尚未完成的同步或下载可能使用错误账本的问题。"
        ]
      },
      {
        heading: "注意事项",
        items: [
          "语言与外观偏好保存在当前浏览器，不跨设备同步；特典头像的解锁记录保存在服务器账号中。",
          "补领采用服务器自动规则（条件满足且尚未拥有时补发），本版未提供手动补领入口。"
        ]
      }
    ],
    major: false
  },
  // 1.16.09 发布候选：尚未发布，status 保持 development、releasedAt 为 null；正式发布后再翻转。
  {
    version: "1.16.09",
    releasedAt: "2026-10-25",
    status: "released",
    title: "账本数据隔离修复",
    summary: "修复新建或切换账本后显示其他账本记录的问题，并修正切换期间的本机缓存与同步归属。",
    sections: [
      {
        heading: "问题修复",
        items: [
          "修复新建或切换账本后，明细和统计可能混入其他账本本机记录的问题；启动时先确定账号与账本，再读取对应数据。",
          "修复切换账本期间，尚未完成的同步或下载可能使用错误账本的问题；请求与本机保存均绑定原账本。",
          "停止将无法确认归属的旧缓存自动复制给新账本。能确认归属错误的本机副本会隔离保留，未同步原件不会自动删除。"
        ]
      },
      {
        heading: "注意事项",
        items: [
          "如旧版已留下归属不明的本机数据，请保留原设备数据以便核查；不要通过清空本机数据来处理，以免丢失尚未同步的记录。",
          "本次修复不会自动删除或改写服务器上的历史账目。"
        ]
      }
    ],
    major: false
  },
  {
    version: "1.16.08",
    releasedAt: "2026-10-24",
    status: "released",
    title: "七套主题与深色外观",
    summary: "新增七套主题色与浅色、深色及跟随系统模式，并整理设置首页和外观预览。",
    sections: [
      {
        heading: "新增功能",
        items: [
          "在「设置 → 显示与数据 → 外观」中选择森林绿、蜜金黄、暖木棕、雾霭蓝、烟霞紫、丹霞红或青瓷灰。主题色与浅色、深色、跟随系统模式可以独立选择，切换立即生效。",
          "深色外观以中性背景和卡片承载内容，品牌色用于交互强调；账本空间保留四层海浪与各主题配色。"
        ]
      },
      {
        heading: "调整及优化",
        items: [
          "设置首页将记账偏好收起为二级入口，默认币种仍在「记账偏好」中设置。",
          "外观页并排展示账本空间与明细的手机比例预览，并随主题实时变化；小屏幕优先保留模式按钮和主题色选项。"
        ]
      },
      {
        heading: "注意事项",
        items: [
          "外观偏好保存在当前浏览器，刷新和切换页面后保留，不跨设备同步。财务收支和分类颜色的含义不随主题色改变。"
        ]
      }
    ],
    major: false
  },
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

/**
 * Stable for a Chinese reader, without inventing a time or timezone.
 *
 * 中文界面输出不变（`2026年10月24日`）；其它语言按当前界面语言走 `Intl`（`Oct 24, 2026`）。
 * 发布日期是日历日，按 UTC 零点解析与格式化，不随设备时区漂移。
 */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  const locale = currentLocale();
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: isChineseLocale(locale) ? "long" : "short",
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
