/**
 * **Motion Token（S19，1.19.44 起）——按交互语义组织的动效时长、缓动与节奏参数的唯一来源。**
 *
 * 用法与原则（规范正文见 docs/specs/design/S19-材质组件与动效设计系统.md 的“Motion Token”一节）：
 * - **按语义取值**：新功能先判断属于哪一类交互（次级导航、主 Tab、对象展开、控件形变、工作模式、高频反馈），
 *   再读对应条目；业务代码不再写新的毫秒数或 cubic-bezier。调整一类交互的节奏只改这里。
 * - **时长是“可见运动”的长度**：转场由帧锚定时钟（lib/frameClock.ts）推进，第一帧固定是起始姿态、卡顿只放慢
 *   不跳过，所以 duration 就是用户实际看到的运动；点击后的准备时间不算在内，要靠减少同步工作缩短。
 * - **`phases` 是同一时钟上的比例（0–1）**：描述内容交接等节奏，改时长时比例保持，交接不会变形。
 * - **高频组件反馈是 CSS 变量**（按下、选中、出现、消失、反馈、加载），按 A / B1 / B2 / C 定义在
 *   `components/ui/component-motion.css`；这里只登记名称（{@link FEEDBACK_CSS}），不复制数值。
 * - 专属品牌动效（底栏指示器 `s19/tabIndicator.ts`、开始页海浪本身 `s19/oceanLayers.ts`）的参数留在各自文件，
 *   它们不是可复用语义；新功能不要借用。账本空间的进入 / 离开转场登记在 {@link LEDGER_TIDE}。
 */

export type MotionStyle = "a" | "b1" | "b2" | "c";

export interface MotionCurve {
  /** 帧锚定时钟上的运动时长（毫秒）。 */
  readonly duration: number;
  readonly easing: string;
}

/** 与 CSS `cubic-bezier()` 相同定义的求值；JS 采样几何、数值时钟与 WAAPI 用同一条曲线。 */
export function easingFunction(css: string): (t: number) => number {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = (css.match(/-?[\d.]+/g) ?? []).map(Number);
  const at = (a: number, b: number, t: number): number => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < x) lo = mid; else hi = mid; }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** 帧锚定时钟本身：单帧推进上限与判定“帧已停止”的间隔。 */
export const MOTION_CLOCK = {
  /** 单帧最多推进约 30fps 的一帧（正常节奏由最近帧间隔的中位数决定，卡顿只推进一个正常帧）。 */
  maxStep: 34,
  /** 连续这么久没有 rAF（后台、停帧的 WebView）就直接收尾。 */
  stallMs: 600,
} as const;

/**
 * 普通次级页面导航（默认“新页从右侧覆盖”，返回回放同一条边）。A / B1 / C 由 ABC 呈现控制器播放
 * （`experiments/abc-motion/controller.js`，时长由这里传入），B2 由 MotionEngine 的原生页面转场播放。
 * 本轮未调校，数值为既有已验收参数的登记。
 */
export const NAVIGATION = {
  b1: { duration: 320, easing: "cubic-bezier(.4,0,.2,1)" },
  b2: { duration: 200, easing: "cubic-bezier(.2,.75,.25,1)" },
  c: { duration: 200, easing: "cubic-bezier(.22,.68,.25,1)" },
  /** A 仍在比较变体：pulse 用 C 的曲线，其余用 B1 的曲线。 */
  a: { pulse: 250, depth: 360, directional: 380, "directional-entry": 400, "pure-cover": 360 },
} as const;

/**
 * 主 Tab 横向交换（switchTab）：两页并排、同一时钟同一曲线，底栏与壁纸不动。
 * 曲线起步约 4% / 帧、10%→90% 约 133ms、末段平稳减速（60Hz 下 13 个 ≥6px 的可见帧）。
 */
export const TAB_SWITCH = {
  duration: 280,
  easing: "cubic-bezier(.3,.15,.15,1)",
  /**
   * 新页面尚未提交（React 还在后台渲染）时，旧页最多先走到的时间（毫秒，≈曲线 8%）：点击后一两帧就有响应，
   * 又不会在新页面到达前露出大片空白。新页面到达后立即放开。
   */
  waitFor: 26,
  /** 仍未提交时以 0.15 倍速继续蠕动，最多到这里（≈13%）；比原地停住更像“在走”，露出的空白也有限。 */
  waitCreep: 0.15,
  waitMax: 36,
  /** 超过这么久新页面仍未提交，就放弃呈现，只交付页面（不让旧页停在半路）。 */
  giveUpMs: 1500,
} as const;

/**
 * Object Expand：账目 / 分析卡片 / 明细汇总从原位置展开为详情，返回时收回。
 *
 * 几何（1.19.44）：一条连续曲线从来源卡片长到整屏。原型的两段节奏（先减速到 18% 的中间帧、再用前冲曲线铺满）
 * 在 60Hz 手机上表现为“停一帧、再一帧跳出 275px”；现在 320ms 内 12 个 ≥6px 的生长帧、单帧最多约 145px。
 * A 的前移（1.1 倍）作为叠加在几何上的一次起伏保留。`phases` 是同一时钟上的交接比例。
 */
export const OBJECT_EXPAND = {
  geometryEasing: "cubic-bezier(.32,.2,.18,1)",
  open: {
    duration: 320,
    phases: {
      /** 容器从透明叠在真实卡片上到完全盖住卡片内容。 */
      cover: [0, 0.12],
      /** 详情内容（按容器宽度缩放、裁剪在容器内）渐显；详情来得晚就从到达时开始。 */
      content: [0.06, 0.4],
      /** 容器几何到达整屏的时间。 */
      geometry: 0.7,
      /** 原页面在整屏容器下退场。 */
      background: [0.68, 0.75],
      /** 容器底色淡回统一壁纸。 */
      surface: [0.73, 0.97],
    },
  },
  close: {
    duration: 300,
    phases: {
      /** 列表与底栏在容器补满（不透明）后出现。 */
      reveal: [0.08, 0.1],
      /** 容器开始收缩与到达来源卡片。 */
      geometry: [0.1, 0.82],
      /** 详情内容在收缩中淡出。 */
      content: [0.5, 0.82],
      /** 容器淡出，露出真实来源卡片。 */
      surface: [0.78, 1],
    },
  },
  /** 展开尚未完成就返回：从当前姿态收回所用时长占展开时长的比例（下限 120ms）。 */
  retractShare: 0.6,
  /** 详情尚未提交时，容器最多长到进度 0.12（约来源卡片三倍高），再以 0.15 倍速蠕动到 0.16；到达即放开。 */
  waitAt: 0.12,
  waitCreep: 0.15,
  waitMax: 0.16,
  /** 超过这么久详情仍未提交，就放弃呈现，只交付页面。 */
  giveUpMs: 1500,
} as const;

/** 控件形变（明细搜索按钮 ↔ 输入框）：胶囊左右展开、标题与按钮让位、顶部收起共用这一条曲线与时长。 */
export const CONTROL_MORPH: MotionCurve = { duration: 200, easing: "cubic-bezier(.2,.72,.2,1)" };

/**
 * 记账工作模式（enterMode，1.19.45）：五种记账方式的进入、完成后离开、工作区内「再记一笔」。
 *
 * 进入是一次整屏的工作区交接（新工作区带着与壁纸对齐的纸面从屏幕底边升起，原页面按风格让位），
 * 所以按普通转场取 300ms 级而不是 1.19.44 的 140ms 揭示：140ms 走完 844px 时第一帧就是 329px，
 * 看不出“从下面上来”。320ms 时 60Hz 有 16 个 ≥6px 的可见帧、单帧最多约 116px、10%→90% 约 150ms。
 * 离开稍短（280ms），同一条曲线；`?enterMs=` 可在 choices 之间比较进入时长。
 */
export const ENTER_MODE = {
  enter: { duration: 320, easing: "cubic-bezier(.32,.4,.16,1)" },
  exit: { duration: 280, easing: "cubic-bezier(.32,.4,.16,1)" },
  choices: [280, 320, 360],
  /** 新页面尚未提交时，纸面最多升到的进度（同时不超过底栏高度占屏幕的比例，停在底栏后面）。 */
  hold: 0.1,
  /** 超过这么久新页面仍未提交，就放弃呈现，只交付页面。 */
  giveUpMs: 1500,
  /** 进入中途返回时倒放的最短时长。 */
  retreatMin: 120,
  /** B1 竖向轨道上两页的间隔（与横向导航轨道相同）。 */
  b1Gap: 24,
  /** 原页面的让位：C 上移屏高的比例并压暗；A 退远缩放并压暗；B2 原地雾化；B1 同轨上移。veil 为壁纸色薄层的不透明度。 */
  styles: {
    c: { shift: 0.18, veil: 0.2 },
    a: { scale: 0.92, veil: 0.45 },
    b1: {},
    b2: { veil: 0.4 },
  },
  /** 「再记一笔」等工作区内轻切换：上一屏上收淡出（到 out），新的一笔从下方升入（从 in 开始）；两者只在上一屏已淡到很低时短暂交叠，不叠影。 */
  again: { duration: 260, easing: "cubic-bezier(.3,.15,.15,1)", rise: 24, drop: 32, out: 0.4, in: 0.35 },
} as const;

/**
 * 账本空间海浪转场（品牌转场，1.19.45，见 s19/motion/tide.ts）：一道浪直接划过整个屏幕。离开时顶栏里的四道浪
 * 按开始页节奏向下展开、不停地继续向下，上边界随后露出目标页、整道浪从下缘离开；进入时反过来从下缘向上拂过，
 * 再收成账本空间的顶栏。展开 / 划过 / 收起是一条按像素排布的连续行程，速度不中断；层间先后与回弹来自开始页的
 * LAYER_MOTION（s19/oceanLayers.ts）。品牌转场不受普通转场 300–400ms 的约束，整段约 1 秒。
 */
export const LEDGER_TIDE = {
  /** 整段行程（展开 + 划过，或划过 + 收起）的时长与曲线。 */
  sweep: { duration: 900, easing: "cubic-bezier(.32,.16,.28,1)" },
  /**
   * 划过时的层间距（屏高比例；展开态是 0.08）。间距加宽、浪只比屏幕厚出 coverWindow，1 号深色核心约 0.3 屏高，
   * 划过时一直有层次在动，不会长时间只看到一整片不变的深色。
   */
  spacing: 0.135,
  /** 整屏被盖住的这段行程（屏高比例）：在这里交接页面，新页面未到时停在这一段里等。 */
  coverWindow: 0.1,
  /** 整页重新载入后，新页面接着交接帧走完剩余一段所用的时长占 sweep 的比例。 */
  resumeShare: 0.6,
  /** 离开时转场层叠上的时间（与页面海浪相同，只盖住品牌字样）。 */
  fadeIn: 90,
  /** 进入结束时转场层淡出、露出页面上的品牌字样。 */
  fadeOut: 140,
  /** 遮挡后超过这么久页面仍未提交，就照常继续。 */
  giveUpMs: 1500,
  /**
   * 切换账本（整页重新载入）的等待提示：整屏被盖住后超过 delay 毫秒仍未完成，1 号深色核心里淡入一行
   * “正在加载新账本……”（fadeIn 毫秒）；新页面接着划过时随浪下移、淡出。载入很快时不出现，不闪一下。
   */
  hint: { delay: 350, fadeIn: 200 },
  /** 新页面已经开始播放交接帧、但协调器迟迟没有挂载时，最多停在原位等这么久再划过。 */
  resumeHoldMs: 3000,
  /**
   * 从页面左下角的当前账本胶囊切换账本（1.19.50）：整道浪从屏幕下缘涌上、盖满整屏后停顿（显示等待提示），
   * 新页面载入后继续向上、从上缘完全离开，不收成顶栏。行程约为划过的 1.3 倍，所以时长单独给出；曲线同 sweep。
   */
  rise: { duration: 1150 },
} as const;

/** 高频组件反馈的 CSS 变量（按风格取值，见 components/ui/component-motion.css）。 */
export const FEEDBACK_CSS = {
  press: "--lv-press-ms",
  select: "--lv-select-ms",
  reveal: "--lv-reveal-ms",
  dismiss: "--lv-dismiss-ms",
  feedback: "--lv-feedback-ms",
  loading: "--lv-loading-ms",
  easing: "--lv-motion-ease",
} as const;
