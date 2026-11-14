/**
 * **统一提示条（Toast）的类型**（1.19.66）。纯类型，不依赖 React。
 *
 * 一个应用级队列（`ToastController`）＋每个外壳一个显示宿主（`components/toast/ToastViewport`）＋一个调用接口
 * `useToast()`。原来的五套实现（撤销条、Pad 外壳提示、分析工作台提示、拍照导入完成提示、头像奖励横幅）都改走这里。
 */

/** 信息 / 成功 / 警告 / 错误。任何类型都可以另带一个操作。 */
export type ToastTone = "info" | "success" | "warning" | "error";

/**
 * - `app`：跨页面保留（删除后返回列表时的撤销、Pad 外壳提示）；
 * - `page`：发出它的组件卸载时撤下，不触发操作（分析工作台、拍照导入完成页、头像奖励）。
 */
export type ToastScope = "app" | "page";

/**
 * 一条提示为什么结束：
 * - `timeout` 到时间；`action` 点了操作；`closed` 点了 × 或按 Esc；
 * - `replaced` 被新的提示替换（带操作的提示被替换后操作结束，不再恢复）；
 * - `expired` 在等待位里等太久被丢弃；`unmounted` 页面作用域的发出者卸载；`dismissed` 调用方自己撤下。
 */
export type ToastEndReason = "timeout" | "action" | "closed" | "replaced" | "expired" | "unmounted" | "dismissed";

export interface ToastAction {
  /** 按钮文字（例如“撤销”“查看”）。 */
  readonly label: string;
  /** 点了以后做什么。提示先消失，再执行（与原撤销条一致）。 */
  readonly run: () => void | Promise<void>;
  /**
   * **提示消失后，用户在哪里还能做同一件事。** 只给开发者看，不显示。
   *
   * 写成必填字段是把 WCAG 2.2.1（时间可调）写进类型：短暂提示里的操作必须有常设替代路径，
   * 否则 10 秒一过功能就丢了。例：删除账目的撤销 → “编辑历史 → 已删除账目 →「恢复」”。
   */
  readonly alternative: string;
}

export interface ToastOptions<Leading = unknown> {
  readonly tone?: ToastTone;
  /** 正文（必填），一句话说清发生了什么。 */
  readonly text: string;
  /** 可选的第二行补充。 */
  readonly detail?: string | undefined;
  /** 可选的前置图（例如头像），代替类型图标。 */
  readonly leading?: Leading;
  readonly action?: ToastAction | undefined;
  /**
   * 合并键：与当前显示（或等待中）的提示 key 相同时原位更新、计时重置，不重播入场。
   * 默认 = 类型 + 文字；带操作的提示默认各自唯一。可以跨类型：“保存失败”与“已保存”给同一个 key，
   * 重试成功时成功消息原位顶掉错误。
   */
  readonly key?: string | undefined;
  readonly scope?: ToastScope;
  /** 页面上已经常驻显示了同样的结果（这里只是回声）：错误也允许自动消失，只用 polite 播报。 */
  readonly echo?: boolean;
  /** 是否交给读屏播报（默认是）。页面别处已经在播报同一句话时传 false，避免读两遍。 */
  readonly announce?: boolean;
  /** 结束时回调一次。 */
  readonly onEnd?: ((reason: ToastEndReason) => void) | undefined;
  /**
   * 真正出现在屏幕上（没有被弹层让开、页面没有切到后台）累计满 `afterMs` 时回调一次。
   * 头像奖励用它实现“可见满 4 秒才回报已读”。悬停、聚焦不影响这个计时（提示仍在屏幕上）。
   */
  readonly onSeen?: { readonly afterMs: number; readonly run: () => void } | undefined;
}

/** 暂停的原因：任何一个成立时停留计时暂停。`yield` 与 `hidden` 时提示也不在屏幕上。 */
export type ToastPauseReason = "hover" | "focus" | "hidden" | "yield";

/** 宿主渲染需要的一条提示。 */
export interface ToastView<Leading = unknown> {
  readonly id: number;
  /** 槽位：合并（同 key 原位更新）时不变，宿主据此不重播入场。 */
  readonly slot: number;
  /** 这个槽位第几次出现在屏幕上：弹层关闭后提示重新出现时加 1，宿主据此重播入场。 */
  readonly appearance: number;
  /** 合并次数：变化时播放一次组件“反馈”轻动效。 */
  readonly revision: number;
  readonly tone: ToastTone;
  readonly text: string;
  readonly detail: string | undefined;
  readonly leading: Leading | undefined;
  readonly action: ToastAction | undefined;
  /** 有没有 ×：错误与带操作的提示有。 */
  readonly closable: boolean;
  readonly echo: boolean;
}

/** 交给读屏的一次播报。`serial` 每次递增，宿主据此先清空再写入，同样的文字也能再读一次。 */
export interface ToastAnnouncement {
  readonly serial: number;
  readonly text: string;
  /** `alert`：页面别处看不到、需要立即知道的错误；其余 `status`。 */
  readonly politeness: "status" | "alert";
  /** 交给宿主拼接读屏文字的原始字段（前缀“警告：”“错误：”、“可撤销”由宿主按当前语言加）。 */
  readonly tone: ToastTone;
  readonly detail: string | undefined;
  readonly actionLabel: string | undefined;
}

export interface ToastSnapshot<Leading = unknown> {
  /** 当前这一条（可能因为弹层打开而暂时不显示，见 `visible`）。 */
  readonly current: ToastView<Leading> | null;
  /** 当前这一条此刻是否应该出现在屏幕上（不在让开、页面没有切到后台）。 */
  readonly visible: boolean;
  readonly announcement: ToastAnnouncement | null;
}
