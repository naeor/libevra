import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { useI18n } from "../../i18n/index.js";
import { copyText } from "../../lib/clipboard.js";
import { ChevronIcon } from "../Icons.js";

/**
 * **S16-A：二级/三级页面的列表与分节积木。**
 *
 * ⚠️ **为什么要有这一层。** S16 之前，"一组设置项"、"一组只读资料"、"一段说明"在各页各写一遍：
 * 同样是 `rounded-card border border-line bg-surface` 外框 + `border-b` 行，有的行带 `›`、有的不带、
 * 有的整行可点却看不出来，有的只是静态信息却长得像按钮。所有者的要求是**统一的是规则，不是模板**：
 *
 * | 内容 | 用什么 |
 * |---|---|
 * | 去往下一页 / 触发一个操作 | `ListRow`（有 `to` 或 `onClick`）：整行可点，末尾是统一的 `›` 图标 |
 * | 设置项 | `ListRow` 的 `value`：名称在左、**当前值在右**、怎么改由末尾决定（`›` 或开关） |
 * | 只读资料 | `FactRow`：标签在左、值在右，**没有箭头也没有按下态**——它不是按钮 |
 * | 一组同类条目 | `ListGroup`：一个外框，行与行之间的分隔线贯通外框（布局规范 §15） |
 * | 说明文字 | `ListGroup` 的 `footer` 或 `ProseSection`：**贴着它解释的东西**，不单独成框 |
 *
 * ⚠️ **行的水平内边距是 `px-5`（20px）**，与设置页、分类页已经确立的列表约定一致；外框本身不加内边距。
 * ⚠️ **分组标题与行内文字左对齐**（`px-5`），读起来是"这一组的名字"，而不是又一个页面标题。
 */

/** 一组同类条目：可选的组名、一个外框、可选的脚注。 */
export function ListGroup({
  title,
  footer,
  action,
  children,
  className = "",
  as = "div",
}: {
  readonly title?: React.ReactNode;
  /** 组下方的说明。**一句话，贴着这一组**；更长的说明请放进对应行的 `detail`。 */
  readonly footer?: React.ReactNode;
  /** 组名右侧的次级操作（绿色文字），例如「全部 ›」。 */
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
  /** 一组只读资料（`FactRow`）用 `dl`，其余用 `div`。 */
  readonly as?: "div" | "dl";
}): React.JSX.Element {
  const Frame = as;

  return (
    <section className={`flex flex-col gap-2 ${className}`.trim()}>
      {title === undefined && action === undefined ? null : (
        <div className="flex items-baseline justify-between gap-3 px-5">
          {title === undefined ? <span /> : <h2 className="text-card-title text-ink">{title}</h2>}
          {action === undefined ? null : <span className="shrink-0 text-helper">{action}</span>}
        </div>
      )}

      <Frame className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
        {children}
      </Frame>

      {footer === undefined || footer === null ? null : (
        <div className="px-5 text-helper-relaxed text-muted">{footer}</div>
      )}
    </section>
  );
}

const ROW_BASE = "flex min-h-13 w-full items-center gap-3 px-5 py-3 text-left";
const ROW_INTERACTIVE =
  "transition-colors hover:bg-canvas active:bg-brand-soft/60 focus-visible:bg-brand-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45";

/**
 * 一行：名称、可选的第二行说明、可选的当前值、末尾的去向。
 *
 * ⚠️ **有 `to` 是链接，有 `onClick` 是按钮，两者都没有就是一段静态内容**——由用途决定元素，
 * 所以"看起来可点"永远等于"真的可点"。
 */
export function ListRow({
  label,
  detail,
  value,
  to,
  state,
  replace,
  onClick,
  disabled = false,
  tone = "default",
  chevron,
  leading,
  trailing,
  dataAttributes,
}: {
  readonly label: React.ReactNode;
  readonly detail?: React.ReactNode;
  /** 设置的当前值，显示在右侧（灰色）。 */
  readonly value?: React.ReactNode;
  readonly to?: string;
  readonly state?: unknown;
  readonly replace?: boolean;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /**
   * `danger`：不可逆操作，名称用警示色。
   * `action`：**就地执行**的操作（不是去往下一页），名称用强调色、默认不画 `›`——
   * 箭头只属于"去往某处"的行。
   */
  readonly tone?: "default" | "danger" | "action";
  /** 默认：可点的行显示 `›`，静态行不显示。 */
  readonly chevron?: boolean;
  readonly leading?: React.ReactNode;
  /** 自定义末尾内容（开关、徽标）。给了它就不再画 `›`，除非 `chevron` 明确为 `true`。 */
  readonly trailing?: React.ReactNode;
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  const interactive = to !== undefined || onClick !== undefined;
  const showChevron = chevron ?? (interactive && trailing === undefined && tone !== "action");
  const labelTone =
    tone === "danger" ? "text-danger" : tone === "action" ? "text-brand-dark" : "text-ink";

  const body = (
    <>
      {leading === undefined ? null : <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-card-title ${labelTone}`}>{label}</span>
        {detail === undefined || detail === null ? null : (
          <span className="text-helper-relaxed text-muted">{detail}</span>
        )}
      </span>
      {value === undefined || value === null ? null : (
        <span className="max-w-[45%] shrink-0 truncate text-right text-body text-muted tabular-nums">{value}</span>
      )}
      {trailing === undefined ? null : <span className="flex shrink-0 items-center">{trailing}</span>}
      {showChevron ? (
        <ChevronIcon direction="right" className={`size-4 ${tone === "danger" ? "text-danger/70" : "text-muted/70"}`} />
      ) : null}
    </>
  );

  if (to !== undefined && !disabled) {
    return (
      <Link
        to={to}
        {...(state === undefined ? {} : { state })}
        {...(replace === undefined ? {} : { replace })}
        className={`${ROW_BASE} ${ROW_INTERACTIVE}`}
        {...dataAttributes}
      >
        {body}
      </Link>
    );
  }

  if (onClick !== undefined || to !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${ROW_BASE} ${ROW_INTERACTIVE}`}
        {...dataAttributes}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={ROW_BASE} {...dataAttributes}>
      {body}
    </div>
  );
}

/**
 * 只读资料：标签在左，值在右。**没有箭头、没有按下态**——它回答"是什么"，不是"去哪里"。
 * 放在 `<ListGroup as="dl">` 里（`dt`/`dd` 需要 `dl` 祖先）。
 *
 * `hint` 是贴在这一项下面的一句解释（例如"用户名：登录时使用"），让说明待在它解释的东西旁边，
 * 而不是在页面另一处再列一遍。
 */
export function FactRow({
  label,
  value,
  hint,
  mono = false,
  action,
}: {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly hint?: React.ReactNode;
  /** 编号、邀请码这类要逐字读的值用等宽字体（排版规范 §5.1）。 */
  readonly mono?: boolean;
  /** 值右侧的小操作，例如复制。 */
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-5 py-3">
      <dt className="min-h-7 content-center text-card-title text-ink">{label}</dt>
      <dd
        className={`flex min-w-0 items-center justify-end gap-2 text-right text-body text-ink tabular-nums ${mono ? "font-mono tracking-wide" : ""}`}
      >
        <span className="min-w-0 truncate">{value}</span>
        {action}
      </dd>
      {hint === undefined || hint === null ? null : (
        <dd className="col-span-2 text-helper-relaxed text-muted">{hint}</dd>
      )}
    </div>
  );
}

/**
 * 一段说明性的内容：小标题 + 正文，**不装进卡片**。
 *
 * ⚠️ 用于"关于"这类以阅读为主的页面：几段短说明各自装一个大白框，会让页面看起来像展示柜；
 * 分节靠标题和留白就够了。
 */
export function ProseSection({
  title,
  children,
}: {
  readonly title: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-section-title text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-body-relaxed text-ink">{children}</div>
    </section>
  );
}

/**
 * 页面内的反馈（错误、成功、提示）。
 *
 * ⚠️ **长错误不该整段铺开。** 服务器的错误说明有时是三四行；放在页面顶部会把要操作的东西推下去，
 * 放在操作旁边又会把一组列表撑开。这里默认最多两行，超出时给一个「展开」——**错误仍然完整可读，
 * 只是不在用户没要求时占满屏幕。** 文字始终在 DOM 里，读屏软件读到的是全文。
 */
export function InlineMessage({
  tone = "error",
  children,
  onDismiss,
}: {
  readonly tone?: "error" | "success" | "info";
  readonly children: React.ReactNode;
  readonly onDismiss?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (element === null) return;
    setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, [children]);

  const palette =
    tone === "error" ? "bg-danger-soft text-danger" : tone === "success" ? "bg-brand-soft text-brand-dark" : "bg-canvas text-muted";

  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-field px-4 py-2.5 ${palette}`}>
      <div className="min-w-0 flex-1">
        <p ref={textRef} className={`text-helper-relaxed break-words ${expanded ? "" : "line-clamp-2"}`}>
          {children}
        </p>
        {overflowing || expanded ? (
          <button
            type="button"
            onClick={() => {
              setExpanded((current) => !current);
            }}
            className="mt-0.5 text-helper font-medium underline-offset-2 hover:underline"
          >
            {expanded ? t("nav.message.collapse") : t("nav.message.expand")}
          </button>
        ) : null}
      </div>
      {onDismiss === undefined ? null : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("nav.message.dismiss")}
          className="-mr-1 shrink-0 rounded-field px-1.5 text-helper opacity-70 transition hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * 行内的小「复制」：账号编号、账本编号这类旁边已经显示了原文的值。
 *
 * ⚠️ **与 `CopyButton` 的分工**：`CopyButton` 是恢复码那种"整段内容 + 大按钮 + 兜底文本框"；
 * 这里的原文就在旁边，所以只需要一个小字按钮，复制失败时提示长按原文即可。
 */
export function CopyInline({
  text,
  label,
}: {
  readonly text: string;
  /** 默认「复制」（`nav.copy.copy`，按当前语言）。 */
  readonly label?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(() => {
    if (phase === "idle") return;
    const timer = window.setTimeout(() => {
      setPhase("idle");
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyText(text).then((outcome) => {
          setPhase(outcome === "copied" ? "copied" : "manual");
        });
      }}
      className="shrink-0 rounded-full px-2 py-0.5 font-sans text-helper tracking-normal text-brand-dark transition hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
    >
      {phase === "copied" ? t("nav.copy.copied") : phase === "manual" ? t("nav.copy.manual") : (label ?? t("nav.copy.copy"))}
    </button>
  );
}
