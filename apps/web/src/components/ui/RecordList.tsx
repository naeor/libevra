import { createContext, useContext } from "react";
import { Link } from "react-router";

/**
 * **S16-A：记录的列表——编辑记录、更新公告这类"按时间排列、逐条浏览"的内容。**
 *
 * ⚠️ **记录不是按钮。** S16 之前，编辑记录和公告每一条都是一块白底圆角卡片或一行粗分隔的大按钮，
 * 读起来像"一排可以按的东西"，而不是"一段连续的经过"。所有者的要求：*"记录应该容易连续浏览；
 * 操作应该容易识别和触发。"* 所以这里：
 *
 * - **页面上的记录直接排在底色上**，条与条之间只有一条细线（左右各缩进到内容边），没有外框；
 * - **每条的主行只占一行**，超出用省略号——长备注不再把这一条撑成三行、把下一条推下去；
 *   完整内容在点开之后的详情里（点按整条即可），桌面端悬停也能看到全文（`title`）；
 * - **时间对齐在右侧**，编号、操作人这类元信息用小一号的灰字，层级一眼可分。
 *
 * ⚠️ **两种所在环境**：`page`（二级页，记录直接铺在页面底色上，悬停底色通到屏幕两边）与
 * `frame`（一级页 `SectionFrame` 的外框里，行自带 `px-5`，与列表约定一致）。由 `RecordList`
 * 决定，行不需要知道。
 */
type Placement = "page" | "frame";

const PlacementContext = createContext<Placement>("page");

export function RecordList({
  children,
  placement = "page",
  label,
}: {
  readonly children: React.ReactNode;
  readonly placement?: Placement;
  /** 给读屏软件的列表名称。 */
  readonly label?: string;
}): React.JSX.Element {
  return (
    <PlacementContext.Provider value={placement}>
      <ul aria-label={label} className="flex flex-col">
        {children}
      </ul>
    </PlacementContext.Provider>
  );
}

/**
 * 一组记录（例如同一天的编辑），带一个滚动时贴在顶部导航下面的小标题。
 *
 * ⚠️ 小标题的 `top` 等于导航条的高度（48px + 1px 细线 + 安全区），所以它停在导航条下沿；
 * 它只在本组范围内吸顶，下一组的标题到来时把它推走——和手机系统列表的分组标题一样。
 */
export function RecordGroup({
  heading,
  children,
}: {
  readonly heading: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col">
      <h2 className="sticky top-[calc(3rem+1px+env(safe-area-inset-top,0px))] z-10 -mx-6 bg-canvas/95 px-6 pt-3 pb-1.5 text-helper font-medium text-muted backdrop-blur-sm">
        {heading}
      </h2>
      <RecordList>{children}</RecordList>
    </section>
  );
}

/**
 * 一条记录。
 *
 * - `eyebrow`：主行上方的一行小字（例如版本号）；有它时 `aside` 与它同一行。
 * - `primary`：主行（单行，超出省略）。
 * - `aside`：主行右侧，通常是时间。
 * - `preview`：主行下的一段预览，最多两行——**固定上限，所以长短不同的预览不会让条目忽高忽低**。
 * - `lines`：主行下的补充行（每行也是单行省略），例如"金额：35.00 → 45.80"。
 * - `meta`：最下面一行灰色小字（操作人、编号、状态）。
 * - `to` / `onClick`：整条可点；没有就是静态记录。
 */
export function RecordRow({
  eyebrow,
  primary,
  title,
  aside,
  preview,
  lines,
  meta,
  to,
  onClick,
  strong = false,
}: {
  readonly eyebrow?: React.ReactNode;
  readonly primary: React.ReactNode;
  readonly preview?: React.ReactNode;
  /** 主行用 `text-card-title`（500）——条目本身是标题时（公告），而不是一句叙述时（编辑记录）。 */
  readonly strong?: boolean;
  /** 主行被截断时的完整文字（桌面端悬停可见）。 */
  readonly title?: string;
  readonly aside?: React.ReactNode;
  readonly lines?: readonly React.ReactNode[];
  readonly meta?: React.ReactNode;
  readonly to?: string;
  readonly onClick?: () => void;
}): React.JSX.Element {
  const placement = useContext(PlacementContext);

  const asideNode =
    aside === undefined ? null : <span className="shrink-0 text-helper text-muted tabular-nums">{aside}</span>;

  const body = (
    <>
      {eyebrow === undefined ? null : (
        <span className="flex min-w-0 items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-helper text-muted">{eyebrow}</span>
          {asideNode}
        </span>
      )}
      <span className="flex min-w-0 items-baseline gap-3">
        <span
          className={`min-w-0 flex-1 truncate ${strong ? "text-card-title" : "text-body"} text-ink`}
          {...(title === undefined ? {} : { title })}
        >
          {primary}
        </span>
        {eyebrow === undefined ? asideNode : null}
      </span>
      {preview === undefined || preview === null ? null : (
        <span className="line-clamp-2 text-helper-relaxed text-muted">{preview}</span>
      )}
      {lines === undefined || lines.length === 0
        ? null
        : lines.map((line, index) => (
            <span key={index} className="block truncate text-helper text-muted">
              {line}
            </span>
          ))}
      {meta === undefined || meta === null ? null : (
        <span className="block truncate text-helper text-muted">{meta}</span>
      )}
    </>
  );

  const padding = placement === "page" ? "-mx-6 px-6" : "px-5";
  const base = `flex flex-col gap-1 py-3 ${padding}`;
  const interactive = "transition-colors hover:bg-surface active:bg-brand-soft/50 focus-visible:bg-brand-soft focus-visible:outline-none";
  return (
    <li className="border-b border-line last:border-b-0">
      {to !== undefined ? (
        <Link to={to} className={`${base} ${interactive}`}>
          {body}
        </Link>
      ) : onClick !== undefined ? (
        <button type="button" onClick={onClick} className={`w-full text-left ${base} ${interactive}`}>
          {body}
        </button>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}
