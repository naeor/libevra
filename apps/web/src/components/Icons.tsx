import type { SVGProps } from "react";

/**
 * Icons used from more than one screen.
 *
 * The project's older icons live beside the component that first needed them —
 * `CameraIcon` and `PlusIcon` in `BottomNav`, `InfoIcon` in `InfoHint`. That was fine
 * while each had one home. This file holds the ones that do not.
 *
 * Drawn the same way as the existing icons so a row of them looks like a row:
 * `currentColor`, `aria-hidden`, and a size the caller gives it.
 */

/** Small outlined gear, with explicit dimensions independent of SVG defaults. */
export function GearIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="m9 3-.6 2.1-1.7 1L4.6 6l-2 3.5 1.5 1.6v1.8l-1.5 1.6 2 3.5 2.1-.1 1.7 1L9 21h4l.6-2.1 1.7-1 2.1.1 2-3.5-1.5-1.6v-1.8l1.5-1.6-2-3.5-2.1.1-1.7-1L13 3Z" transform="translate(1)" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

/**
 * Three dots in a row, for "there is more behind here".
 *
 * ⚠️ **Filled circles, not an outline.** Every other icon in this file is stroked, and this
 * one is deliberately not: three small rings at 20 px read as a dotted line, where three
 * filled dots read as a menu — which is the convention on every platform the user has ever
 * held.
 *
 * Horizontal rather than vertical: a vertical ellipsis means the same thing, but on a phone
 * the horizontal one sits in a top-right corner without looking like a scrollbar.
 */
export function MoreIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}

/** Two overlapping sheets, for "copy this text". */
export function CopyIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/**
 * A plus, for "make another one".
 *
 * ⚠️ **This is the second `PlusIcon` in the project and they are different drawings.**
 * `BottomNav` has one at 24 px with `strokeWidth` heavy enough for the raised centre button —
 * it is part of that button's look, not a general icon. **Moving it here would have been the
 * wrong repair**: the recording button needs its own weight, and changing it to share with a
 * text-sized plus would have altered the bar to serve a list.
 *
 * ⚠️ **So the duplication is deliberate, and the comment at the top of this file is what
 * covers it** — *"The project's older icons live beside the component that first needed them
 * …… That was fine while each had one home."* The start page's 新建账本 is the second home,
 * which is the condition that file names for moving in here.
 *
 * Sized to sit beside `text-sm` text without changing the line height.
 */
export function PlusIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className="size-4"
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * The one disclosure arrow: 收起/展开、打开面板、"还有一项".
 *
 * ⚠️ **Why this exists** (S15-C 第四轮). 这一页原来在四处写 `⌄` / `⌃`：币种按钮、快捷金额、
 * 更多选项、分类。同一个"展开"在两个地方是不同字符，`⌄` 与 `⌃` 的字形宽度也不一样，12px 的
 * 字符夹在 15–36px 的文字之间就像一颗掉下来的小点。**一个字符不是图标**——它没有固定的
 * 画布、不能旋转、宽度还由字体决定，所以两处箭头不可能长得一样。
 *
 * ⚠️ **One path, one box, two directions.** 收起与展开是**同一个 SVG**，只把 `up` 打开时
 * 旋转 180°。`transform` 不进入布局，所以两种状态的占位、与文字的间距、行高完全一致，
 * 展开时不会把左边的字挤动。尺寸 14px：约 1–1.5 个 15px 字母宽，比原来的 `⌄` 宽一点、
 * 比正文小一档，不再用"放大字号"来加宽箭头。
 *
 * ⚠️ **不要再用字符画箭头。** 以后需要方向箭头时用这个组件（或给它加 `left`/`right`），
 * 不要退回 `⌄` / `⌃` / `▾`：字体一换，它们又会各长各的。
 *
 * ⚠️ **S16-A 加了 `direction`，仍是同一个 SVG。** 返回导航用 `left`，列表行末尾的"进入下一页"用
 * `right`——它们以前分别是字符 `←` 与 `›`，正是上面说的"字体一换就各长各的"。`up` 保留为原来的
 * 写法（展开/收起），四个方向都只是旋转这一条路径，所以占位与描边粗细完全一致。
 */
export function ChevronIcon({
  up = false,
  direction,
  className = "",
}: {
  /** 展开状态传 `true`：同一个图形转 180°，不是另一个字符。 */
  readonly up?: boolean;
  /** 显式方向；不传时由 `up` 决定（向上或向下）。 */
  readonly direction?: "down" | "up" | "left" | "right";
  readonly className?: string;
}): React.JSX.Element {
  const facing = direction ?? (up ? "up" : "down");
  const rotation =
    facing === "up" ? "-rotate-180" : facing === "left" ? "rotate-90" : facing === "right" ? "-rotate-90" : "";

  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-chevron={facing}
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-200 ease-out ${rotation} ${className}`.trim()}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * **The account avatar: a portrait silhouette, which is the convention everybody already knows.**
 *
 * ⚠️ **The owner asked for exactly this** (2026-10-13): *"图标是那种一个灰色的默认头像半身像那样的样子.
 * 你可以上网搜一下."* A search confirms it is the standard placeholder — a bust in a circle, drawn flat —
 * as used by essentially every account system
 * ([example](https://clipart-library.com/clipart/avatar-cliparts-17.htm)).
 *
 * ⚠️ **⚠️ This replaces `DefaultAvatar` *in this position*, and it is not a redrawing of it.** That
 * component is a **six-petal flower** — the project's own mark, and a deliberate placeholder for a
 * user-chosen picture. **The owner is not asking for the flower to change**; he is asking for the green
 * band's corner control to read as *an account*, which a flower does not. **Both now exist, each with
 * one home**: the flower where somebody's own avatar would go, this where the app must say "this is you".
 *
 * ⚠️ **Grey by construction, not by a literal.** The silhouette is `currentColor`, so it takes the
 * colour of whatever holds it, and the corner button sets that to the muted token. **`colors.test.ts`
 * forbids hex literals outside the token files**, and this is the better shape anyway: a grey written
 * down once is a grey that cannot follow the theme.
 *
 * ⚠️ **The disc is tinted from the same colour rather than white.** The button sits on the green band,
 * where a white disc would be a bright dot competing with the wordmark — the opposite of the
 * "柔和、安静" this screen is meant to have.
 */
export function AvatarIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {/* The disc the portrait sits in. */}
      <circle cx="12" cy="12" r="12" fill="currentColor" opacity={0.16} />
      {/*
        ⚠️ **Head and shoulders, filled as one silhouette, and they overlap on purpose.** Drawing them
        as two outlines leaves a gap at the neck, and at 22 px the whole point of the convention is that
        the shape is recognised instantly rather than studied.
      */}
      <g fill="currentColor">
        <circle cx="12" cy="9.7" r="4" />
        <path d="M12 15.2c-4.1 0-7.1 2.5-7.8 6A12 12 0 0 0 12 24a12 12 0 0 0 7.8-2.8c-.7-3.5-3.7-6-7.8-6Z" />
      </g>
    </svg>
  );
}

/**
 * **语言 / 地球图标（S16 国际化）。** 登录页语言切换按钮用；描边与 `GearIcon` 同粗细，跟随 `currentColor`。
 */
export function GlobeIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  );
}

/**
 * **一条引用 —— 引号形状的一对逗号，不是「消息气泡」。**
 *
 * ⚠️ 留言引用的是**账目与修改记录**，不是回复某个人；用聊天的「回复箭头」会让这块区域看起来像一个
 * 私聊线程，而那正是所有者反复排除的形态。引号是「这里引用了别处的一句话」的通用记号，和
 * `QuoteReferenceCard` 的形态一致。
 */
export function QuoteIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 8.5c0 3-2 4.5-4.2 5.5M10 8.5H6.2A2.2 2.2 0 0 0 4 10.7v.8a2.2 2.2 0 0 0 2.2 2.2H10V8.5Z" />
      <path d="M20 8.5c0 3-2 4.5-4.2 5.5M20 8.5h-3.8a2.2 2.2 0 0 0-2.2 2.2v.8a2.2 2.2 0 0 0 2.2 2.2H20V8.5Z" />
    </svg>
  );
}

/** Close an overlay — a thin cross, sized by the caller. */
export function CloseIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
