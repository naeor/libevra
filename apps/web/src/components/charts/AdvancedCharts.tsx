/**
 * S17-C 专用图表家族（1.17.10）：直方、箱线、帕累托、瀑布、增减条、热力矩阵、堆叠柱、矩形树图、名次变化、
 * 散点、气泡、小多图、全年日历、斜率、离散汇率点、数据表。
 *
 * ⚠️ **这里只画已经算好的结果。** 金额、占比、分位、归因全部来自 `@libellum/shared` 的 C 计算；
 * 组件只接收「显示文本」与「仅用于几何的 0–1 比例」，不做任何财务计算，也不从几何反推数值。
 * 每个图形元素都带 `<title>` 读数，整张图有 `role="img"` 与标题；颜色不是唯一的信息通道
 * （正负用方向与符号、热力格写数值、离群点单独列出）。
 */
import { ChartFrame } from "../chart/ChartFrame.js";
import { computeTreemapBoxes } from "../../analysis/geometry4.js";
import { categoricalColor, EXPENSE_COLOR, heatColor, INCOME_COLOR } from "../../lib/chart/theme.js";

const MUTED = "var(--color-muted)";
const LINE = "var(--color-line)";
const RULE = "var(--color-chart-rule)";
const BRAND = "var(--color-brand)";

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * 把一列标签的纵坐标错开至少 `gap`，并尽量留在 [top, bottom] 内（`null` = 不画标签，原样返回）。
 * 只用于文字位置；数据点本身仍画在真实位置。
 */
export function spreadLabels(ys: readonly (number | null)[], gap: number, top: number, bottom: number): (number | null)[] {
  const order = ys.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value !== null).sort((a, b) => a.value - b.value || a.index - b.index);
  const placed = order.map((item) => item.value);
  for (let i = 1; i < placed.length; i += 1) placed[i] = Math.max(placed[i]!, placed[i - 1]! + gap);
  const overflow = (placed[placed.length - 1] ?? bottom) - bottom;
  if (overflow > 0) {
    // 整体上移，但不越过上边界；仍放不下时保持最小间距（宁可略出下边界也不叠字）。
    for (let i = placed.length - 1; i >= 0; i -= 1) {
      const limit = i === placed.length - 1 ? bottom : placed[i + 1]! - gap;
      placed[i] = Math.max(top + i * gap, Math.min(placed[i]!, limit));
    }
  }
  const result: (number | null)[] = ys.map(() => null);
  order.forEach((item, at) => {
    result[item.index] = placed[at]!;
  });
  return result;
}

/** 文字宽度的粗估单位（全角字符算 1.8 个半角）。 */
function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += /[　-鿿＀-￯]/.test(ch) ? 1.8 : 1;
  return units;
}

/** 文字是否放得下（按字符数粗估，只决定显示与否，不缩小字号）。 */
function fits(text: string, width: number, charWidth = 6.6): boolean {
  return textUnits(text) * charWidth <= width;
}

// ---------------------------------------------------------------------------
// 横向条（排行 / 构成 / 帕累托的列表形态）
// ---------------------------------------------------------------------------

export interface BarRow {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  /** 0–1，仅几何。 */
  readonly fraction: number;
  readonly secondary?: string | null;
  readonly color?: string;
}

export function BarRows({ rows, limit, moreText, title }: { readonly rows: readonly BarRow[]; readonly limit: number; readonly moreText: (count: number) => string; readonly title: string }): React.JSX.Element {
  const shown = rows.slice(0, Math.max(1, limit));
  const hidden = rows.length - shown.length;
  return (
    <div className="flex min-h-0 flex-col gap-1.5" role="list" aria-label={title}>
      {shown.map((row, index) => (
        <div key={row.id} role="listitem" className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-helper">
            <span className="flex min-w-0 items-center gap-1.5 text-ink">
              <span className="sw-dot" style={{ backgroundColor: row.color ?? categoricalColor(index) }} aria-hidden="true" />
              <span className="truncate" title={row.label}>{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {row.valueText}
              {row.secondary === undefined || row.secondary === null ? null : <span className="ml-1 text-muted">{row.secondary}</span>}
            </span>
          </div>
          <span className="sw-bar mt-1 block" aria-hidden="true">
            <span style={{ width: `${String(Math.max(2, clamp01(row.fraction) * 100))}%`, backgroundColor: row.color ?? categoricalColor(index) }} />
          </span>
        </div>
      ))}
      {hidden > 0 ? <p className="text-helper text-muted">{moreText(hidden)}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 增减条（发散条，CF-C02）
// ---------------------------------------------------------------------------

export interface DivergingRow {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  /** −1…1：负 = 减少（向左），正 = 增加（向右），仅几何。 */
  readonly fraction: number;
  readonly secondary?: string | null;
}

export function DivergingRows({ rows, limit, moreText, title }: { readonly rows: readonly DivergingRow[]; readonly limit: number; readonly moreText: (count: number) => string; readonly title: string }): React.JSX.Element {
  const shown = rows.slice(0, Math.max(1, limit));
  const hidden = rows.length - shown.length;
  return (
    <div className="flex min-h-0 flex-col gap-1.5" role="list" aria-label={title}>
      {shown.map((row) => {
        const value = Math.max(-1, Math.min(1, Number.isFinite(row.fraction) ? row.fraction : 0));
        const width = `${String(Math.max(1.5, Math.abs(value) * 50))}%`;
        return (
          <div key={row.id} role="listitem" className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-helper">
              <span className="truncate text-ink" title={row.label}>{row.label}</span>
              <span className={`shrink-0 tabular-nums ${value < 0 ? "text-data-income" : value > 0 ? "text-data-expense" : "text-muted"}`}>
                {row.valueText}
                {row.secondary === undefined || row.secondary === null ? null : <span className="ml-1 text-muted">{row.secondary}</span>}
              </span>
            </div>
            <span className="relative mt-1 block h-[0.3rem] rounded-full bg-canvas" aria-hidden="true">
              <span className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px" style={{ backgroundColor: RULE }} />
              <span
                className="absolute top-0 bottom-0 rounded-full"
                style={value < 0 ? { right: "50%", width, backgroundColor: INCOME_COLOR } : { left: "50%", width, backgroundColor: EXPENSE_COLOR }}
              />
            </span>
          </div>
        );
      })}
      {hidden > 0 ? <p className="text-helper text-muted">{moreText(hidden)}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 纵向柱（直方图、回退天数分布等有序桶）
// ---------------------------------------------------------------------------

export interface ColumnBar {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  /** 0–1，仅几何。 */
  readonly fraction: number;
  readonly highlight?: boolean;
}

export function ColumnChart({ bars, height, title, color = BRAND }: { readonly bars: readonly ColumnBar[]; readonly height: number; readonly title: string; readonly color?: string }): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 8, right: 4, bottom: 20, left: 4 }}>
      {(layout) => {
        const slot = layout.innerWidth / Math.max(1, bars.length);
        const barWidth = Math.max(2, slot * 0.78);
        const every = Math.max(1, Math.ceil((bars.reduce((max, bar) => Math.max(max, bar.label.length), 0) * 6.2 + 6) / Math.max(1, slot)));
        return (
          <>
            <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top + layout.innerHeight} y2={layout.padding.top + layout.innerHeight} stroke={RULE} strokeWidth={1} />
            {bars.map((bar, index) => {
              const h = clamp01(bar.fraction) * layout.innerHeight;
              const x = layout.padding.left + index * slot + (slot - barWidth) / 2;
              return (
                <g key={bar.id}>
                  <rect x={x} y={layout.padding.top + layout.innerHeight - h} width={barWidth} height={Math.max(h, bar.fraction > 0 ? 1 : 0)} rx={1} fill={bar.highlight === true ? EXPENSE_COLOR : color} fillOpacity={0.85}>
                    <title>{`${bar.label} · ${bar.valueText}`}</title>
                  </rect>
                  {index % every === 0 ? (
                    <text x={x + barWidth / 2} y={layout.height - 5} textAnchor="middle" fontSize={10} fill={MUTED}>{bar.label}</text>
                  ) : null}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 帕累托（柱 + 累计线，CF-C04）
// ---------------------------------------------------------------------------

export interface ParetoBar {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly cumulativeText: string;
  /** 本项占最大项（0–1）与累计占比（0–1），仅几何。 */
  readonly fraction: number;
  readonly cumulative: number;
}

export function ParetoChart({ rows, height, title }: { readonly rows: readonly ParetoBar[]; readonly height: number; readonly title: string }): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 10, right: 30, bottom: 20, left: 4 }}>
      {(layout) => {
        const slot = layout.innerWidth / Math.max(1, rows.length);
        const barWidth = Math.max(3, slot * 0.7);
        const bottom = layout.padding.top + layout.innerHeight;
        const points = rows.map((row, index) => `${String(layout.padding.left + index * slot + slot / 2)},${String(bottom - clamp01(row.cumulative) * layout.innerHeight)}`).join(" ");
        const every = Math.max(1, Math.ceil(44 / Math.max(1, slot)));
        return (
          <>
            <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={bottom} y2={bottom} stroke={RULE} />
            <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top} y2={layout.padding.top} stroke={LINE} strokeDasharray="3 3" />
            <text x={layout.width - 2} y={layout.padding.top + 4} textAnchor="end" fontSize={10} fill={MUTED}>100%</text>
            {rows.map((row, index) => {
              const h = clamp01(row.fraction) * layout.innerHeight;
              const x = layout.padding.left + index * slot + (slot - barWidth) / 2;
              return (
                <g key={row.id}>
                  <rect x={x} y={bottom - h} width={barWidth} height={h} rx={1} fill={categoricalColor(index)} fillOpacity={0.8}>
                    <title>{`${row.label} · ${row.valueText} · ${row.cumulativeText}`}</title>
                  </rect>
                  {index % every === 0 && fits(row.label, slot * every) ? <text x={x + barWidth / 2} y={layout.height - 5} textAnchor="middle" fontSize={10} fill={MUTED}>{row.label}</text> : null}
                </g>
              );
            })}
            <polyline points={points} fill="none" stroke={BRAND} strokeWidth={1.6} strokeLinejoin="round" />
            {rows.map((row, index) => (
              <circle key={`c-${row.id}`} cx={layout.padding.left + index * slot + slot / 2} cy={bottom - clamp01(row.cumulative) * layout.innerHeight} r={2.4} fill={BRAND}>
                <title>{`${row.label} · ${row.cumulativeText}`}</title>
              </circle>
            ))}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 瀑布（CF-C03）：起点 + 各项增减 + 终点；几何来自同一份归因结果
// ---------------------------------------------------------------------------

export interface WaterfallBar {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly kind: "start" | "delta" | "total";
  /** 在同一刻度（0–1，相对最大累计值）上的起止位置，仅几何。 */
  readonly from: number;
  readonly to: number;
}

export function WaterfallChart({ bars, height, title }: { readonly bars: readonly WaterfallBar[]; readonly height: number; readonly title: string }): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 8, right: 4, bottom: 20, left: 4 }}>
      {(layout) => {
        const slot = layout.innerWidth / Math.max(1, bars.length);
        const barWidth = Math.max(4, slot * 0.66);
        const bottom = layout.padding.top + layout.innerHeight;
        const y = (fraction: number) => bottom - clamp01(fraction) * layout.innerHeight;
        return (
          <>
            <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={bottom} y2={bottom} stroke={RULE} />
            {bars.map((bar, index) => {
              const top = Math.min(y(bar.from), y(bar.to));
              const h = Math.max(1, Math.abs(y(bar.from) - y(bar.to)));
              const x = layout.padding.left + index * slot + (slot - barWidth) / 2;
              const increase = bar.to > bar.from;
              const fill = bar.kind === "delta" ? (increase ? EXPENSE_COLOR : INCOME_COLOR) : RULE;
              return (
                <g key={bar.id}>
                  <rect x={x} y={top} width={barWidth} height={h} rx={1} fill={fill} fillOpacity={bar.kind === "delta" ? 0.85 : 0.6}>
                    <title>{`${bar.label} · ${bar.valueText}`}</title>
                  </rect>
                  {index < bars.length - 1 ? <line x1={x + barWidth} x2={x + slot} y1={y(bar.to)} y2={y(bar.to)} stroke={RULE} strokeDasharray="2 2" /> : null}
                  {fits(bar.label, slot) ? <text x={x + barWidth / 2} y={layout.height - 5} textAnchor="middle" fontSize={10} fill={MUTED}>{bar.label}</text> : null}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 箱线（CF-C06）：一组或多组，所有组共用同一数轴
// ---------------------------------------------------------------------------

export interface BoxGroup {
  readonly id: string;
  readonly label: string;
  readonly summaryText: string;
  readonly reliable: boolean;
  /** 0–1（共同数轴），仅几何。 */
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
  readonly outliers: readonly number[];
}

export function BoxplotChart({ groups, height, title, axisText, unreliableText }: { readonly groups: readonly BoxGroup[]; readonly height: number; readonly title: string; readonly axisText: string; readonly unreliableText: string }): React.JSX.Element {
  const labelWidth = groups.length > 1 ? 64 : 0;
  return (
    <div>
      <ChartFrame height={height} title={title} padding={{ top: 6, right: 8, bottom: 14, left: labelWidth + 6 }}>
        {(layout) => {
          const band = layout.innerHeight / Math.max(1, groups.length);
          const box = Math.max(6, Math.min(22, band * 0.55));
          const x = (fraction: number) => layout.padding.left + clamp01(fraction) * layout.innerWidth;
          return (
            <>
              {groups.map((group, index) => {
                const cy = layout.padding.top + index * band + band / 2;
                const opacity = group.reliable ? 0.85 : 0.35;
                return (
                  <g key={group.id}>
                    <title>{`${group.label} · ${group.summaryText}${group.reliable ? "" : ` · ${unreliableText}`}`}</title>
                    {labelWidth > 0 ? <text x={4} y={cy + 3.5} fontSize={10} fill={MUTED}>{group.label.length > 6 ? `${group.label.slice(0, 5)}…` : group.label}</text> : null}
                    <line x1={x(group.min)} x2={x(group.max)} y1={cy} y2={cy} stroke={RULE} strokeWidth={1.2} />
                    <line x1={x(group.min)} x2={x(group.min)} y1={cy - box / 3} y2={cy + box / 3} stroke={RULE} />
                    <line x1={x(group.max)} x2={x(group.max)} y1={cy - box / 3} y2={cy + box / 3} stroke={RULE} />
                    <rect x={x(group.q1)} y={cy - box / 2} width={Math.max(1, x(group.q3) - x(group.q1))} height={box} rx={2} fill={BRAND} fillOpacity={opacity * 0.35} stroke={BRAND} strokeOpacity={opacity} strokeDasharray={group.reliable ? undefined : "3 2"} />
                    <line x1={x(group.median)} x2={x(group.median)} y1={cy - box / 2} y2={cy + box / 2} stroke={EXPENSE_COLOR} strokeWidth={2} />
                    {group.outliers.map((outlier, at) => (
                      <circle key={at} cx={x(outlier)} cy={cy} r={2.2} fill="none" stroke={EXPENSE_COLOR} />
                    ))}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartFrame>
      <p className="truncate text-helper text-muted" title={axisText}>{axisText}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 热力矩阵（CF-C08）：行 × 列，每格写数值；空格写「—」（该组合没有发生，不是 0）
// ---------------------------------------------------------------------------

export interface MatrixCellView {
  readonly text: string;
  /** 0–1 强度，仅着色。 */
  readonly intensity: number;
  readonly title: string;
}

export function HeatMatrix({
  rows,
  cols,
  cell,
  title,
  maxRows,
  moreText,
  emptyTitle,
}: {
  readonly rows: readonly { readonly id: string; readonly label: string; readonly totalText: string }[];
  readonly cols: readonly { readonly id: string; readonly label: string }[];
  readonly cell: (rowId: string, colId: string) => MatrixCellView | null;
  readonly title: string;
  readonly maxRows: number;
  readonly moreText: (count: number) => string;
  readonly emptyTitle: string;
}): React.JSX.Element {
  const shown = rows.slice(0, Math.max(1, maxRows));
  const hidden = rows.length - shown.length;
  return (
    <div className="sw-interactive min-h-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabIndex={0} aria-label={title} onClick={(event) => event.stopPropagation()}>
      <table className="w-full border-separate border-spacing-0.5 text-[0.6875rem] tabular-nums" aria-label={title}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface" />
            {cols.map((col) => <th key={col.id} scope="col" className="px-0.5 font-normal whitespace-nowrap text-muted">{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="sticky left-0 max-w-[5rem] truncate bg-surface pr-1 text-left font-normal text-ink" title={`${row.label} · ${row.totalText}`}>{row.label}</th>
              {cols.map((col) => {
                const value = cell(row.id, col.id);
                const level = value === null ? 0 : 1 + Math.round(clamp01(value.intensity) * 3);
                return (
                  <td
                    key={col.id}
                    title={value === null ? emptyTitle : value.title}
                    className="min-w-[2.25rem] rounded px-0.5 text-center whitespace-nowrap"
                    style={{ backgroundColor: heatColor(level), color: level >= 3 ? "var(--color-on-heat)" : "var(--color-ink)" }}
                  >
                    {value === null ? "—" : value.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? <p className="text-helper text-muted">{moreText(hidden)}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 堆叠柱（CF-C09）：每个桶一根柱，按序列堆叠；柱高 = 该桶合计 / 最大桶合计
// ---------------------------------------------------------------------------

export interface StackedColumn {
  /** 稳定 ID（同名的两个支付方式也不会互相覆盖）。 */
  readonly id: string;
  readonly label: string;
  readonly totalText: string;
  /** 每个序列在这一桶的高度（0–1，相对最大桶合计），仅几何。 */
  readonly parts: readonly { readonly seriesId: string; readonly fraction: number; readonly text: string }[];
}

export function StackedColumns({ columns, series, height, title }: { readonly columns: readonly StackedColumn[]; readonly series: readonly { readonly id: string; readonly label: string }[]; readonly height: number; readonly title: string }): React.JSX.Element {
  const colorOf = new Map(series.map((item, index) => [item.id, categoricalColor(index)] as const));
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <ChartFrame height={height} title={title} padding={{ top: 6, right: 4, bottom: 18, left: 4 }}>
        {(layout) => {
          const slot = layout.innerWidth / Math.max(1, columns.length);
          const barWidth = Math.max(4, slot * 0.66);
          const bottom = layout.padding.top + layout.innerHeight;
          const every = Math.max(1, Math.ceil(40 / Math.max(1, slot)));
          return (
            <>
              <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={bottom} y2={bottom} stroke={RULE} />
              {columns.map((column, index) => {
                const x = layout.padding.left + index * slot + (slot - barWidth) / 2;
                let offset = 0;
                return (
                  <g key={column.id}>
                    {column.parts.map((part) => {
                      const h = clamp01(part.fraction) * layout.innerHeight;
                      const y = bottom - offset - h;
                      offset += h;
                      return (
                        <rect key={part.seriesId} x={x} y={y} width={barWidth} height={h} fill={colorOf.get(part.seriesId) ?? MUTED} fillOpacity={0.85}>
                          <title>{`${column.label} · ${series.find((item) => item.id === part.seriesId)?.label ?? part.seriesId} · ${part.text}`}</title>
                        </rect>
                      );
                    })}
                    <title>{`${column.label} · ${column.totalText}`}</title>
                    {index % every === 0 ? <text x={x + barWidth / 2} y={layout.height - 4} textAnchor="middle" fontSize={10} fill={MUTED}>{column.label}</text> : null}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartFrame>
      <Legend items={series.map((item) => ({ id: item.id, label: item.label, color: colorOf.get(item.id) ?? MUTED }))} />
    </div>
  );
}

function Legend({ items }: { readonly items: readonly { readonly id: string; readonly label: string; readonly color: string }[] }): React.JSX.Element {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-helper text-muted">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-1">
          <span className="sw-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span className="max-w-[7rem] truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 矩形树图（CF-C11）：一级分类的面积 = 金额；当前分类没有层级，按一级分类显示（不猜层级）
// ---------------------------------------------------------------------------

export function TreemapChart({ items, height, title }: { readonly items: readonly { readonly id: string; readonly label: string; readonly value: number; readonly valueText: string }[]; readonly height: number; readonly title: string }): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 0, right: 0, bottom: 0, left: 0 }}>
      {(layout) => {
        if (layout.width <= 0 || layout.height <= 0) return null;
        const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
        const boxes = total <= 0 ? [] : computeTreemapBoxes(
          items.map((item) => ({ nodeId: item.id, fractionOfTotal: Math.max(0, item.value) / total })),
          { width: layout.width, height: layout.height, gap: 2 },
        );
        const byId = new Map(items.map((item, index) => [item.id, { item, index }] as const));
        return (
          <>
            {boxes.map(({ nodeId, box }) => {
              const entry = byId.get(nodeId);
              if (entry === undefined) return null;
              const showLabel = box.width > 44 && box.height > 26;
              return (
                <g key={nodeId}>
                  <rect x={box.x} y={box.y} width={Math.max(0, box.width)} height={Math.max(0, box.height)} rx={3} fill={categoricalColor(entry.index)} fillOpacity={0.82}>
                    <title>{`${entry.item.label} · ${entry.item.valueText}`}</title>
                  </rect>
                  {showLabel ? (
                    <>
                      <text x={box.x + 6} y={box.y + 15} fontSize={11} fill="var(--color-on-heat)">{fits(entry.item.label, box.width - 10, 6.4) ? entry.item.label : `${entry.item.label.slice(0, 2)}…`}</text>
                      {box.height > 40 && fits(entry.item.valueText, box.width - 10, 6) ? <text x={box.x + 6} y={box.y + 29} fontSize={10} fill="var(--color-on-heat)">{entry.item.valueText}</text> : null}
                    </>
                  ) : null}
                </g>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 名次变化（Bump，CF-C13）：横轴 = 周期，纵轴 = 名次（第 1 名在上）
// ---------------------------------------------------------------------------

export function BumpChart({ periods, lines, maxRank, height, title }: {
  readonly periods: readonly string[];
  readonly lines: readonly { readonly id: string; readonly label: string; readonly ranks: readonly (number | null)[] }[];
  readonly maxRank: number;
  readonly height: number;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <ChartFrame height={height} title={title} padding={{ top: 8, right: 10, bottom: 18, left: 24 }}>
        {(layout) => {
          const step = periods.length > 1 ? layout.innerWidth / (periods.length - 1) : 0;
          const x = (index: number) => layout.padding.left + (periods.length > 1 ? index * step : layout.innerWidth / 2);
          const y = (rank: number) => layout.padding.top + ((rank - 1) / Math.max(1, maxRank - 1)) * layout.innerHeight;
          const every = Math.max(1, Math.ceil(36 / Math.max(1, step)));
          return (
            <>
              {Array.from({ length: maxRank }, (_, index) => (
                <text key={index} x={4} y={y(index + 1) + 3} fontSize={9} fill={MUTED}>{index + 1}</text>
              ))}
              {lines.map((line, lineIndex) => {
                const color = categoricalColor(lineIndex);
                const segments: string[] = [];
                let current = "";
                line.ranks.forEach((rank, index) => {
                  if (rank === null) {
                    if (current !== "") segments.push(current);
                    current = "";
                    return;
                  }
                  current += `${current === "" ? "M" : "L"}${String(x(index))},${String(y(rank))}`;
                });
                if (current !== "") segments.push(current);
                return (
                  <g key={line.id}>
                    {segments.map((d, at) => <path key={at} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />)}
                    {line.ranks.map((rank, index) => rank === null ? null : (
                      <circle key={index} cx={x(index)} cy={y(rank)} r={3} fill={color}>
                        <title>{`${line.label} · ${periods[index] ?? ""} · #${String(rank)}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
              {periods.map((period, index) => index % every === 0 ? <text key={period} x={x(index)} y={layout.height - 4} textAnchor={index === 0 && periods.length > 1 ? "start" : index === periods.length - 1 && periods.length > 1 ? "end" : "middle"} fontSize={10} fill={MUTED}>{period}</text> : null)}
            </>
          );
        }}
      </ChartFrame>
      <Legend items={lines.map((line, index) => ({ id: line.id, label: line.label, color: categoricalColor(index) }))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 散点（CF-C14）与气泡（CF-C15）
// ---------------------------------------------------------------------------

export function ScatterChart({ points, xLabels, height, title, maxText }: {
  readonly points: readonly { readonly id: string; readonly x: number; readonly y: number; readonly text: string; readonly color?: string }[];
  readonly xLabels: readonly { readonly at: number; readonly label: string }[];
  readonly height: number;
  readonly title: string;
  readonly maxText: string;
}): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 10, right: 6, bottom: 18, left: 6 }}>
      {(layout) => (
        <>
          <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top + layout.innerHeight} y2={layout.padding.top + layout.innerHeight} stroke={RULE} />
          <text x={layout.padding.left} y={layout.padding.top - 1} fontSize={9} fill={MUTED}>{maxText}</text>
          {points.map((point) => (
            <circle key={point.id} cx={layout.padding.left + clamp01(point.x) * layout.innerWidth} cy={layout.padding.top + (1 - clamp01(point.y)) * layout.innerHeight} r={2.6} fill={point.color ?? EXPENSE_COLOR} fillOpacity={0.55}>
              <title>{point.text}</title>
            </circle>
          ))}
          {xLabels.map((label) => (
            // 两端的刻度向内对齐，避免被卡片边缘裁掉。
            <text key={`${String(label.at)}-${label.label}`} x={layout.padding.left + clamp01(label.at) * layout.innerWidth} y={layout.height - 4} textAnchor={label.at <= 0 ? "start" : label.at >= 1 ? "end" : "middle"} fontSize={10} fill={MUTED}>{label.label}</text>
          ))}
        </>
      )}
    </ChartFrame>
  );
}

export function BubbleChart({ bubbles, height, title, xText, yText }: {
  readonly bubbles: readonly { readonly id: string; readonly label: string; readonly x: number; readonly y: number; readonly r: number; readonly text: string }[];
  readonly height: number;
  readonly title: string;
  readonly xText: string;
  readonly yText: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      <ChartFrame height={height} title={title} padding={{ top: 14, right: 14, bottom: 14, left: 14 }}>
        {(layout) => {
          const maxRadius = Math.max(6, Math.min(layout.innerWidth, layout.innerHeight) / 5);
          return (
            <>
              <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top + layout.innerHeight} y2={layout.padding.top + layout.innerHeight} stroke={RULE} />
              <line x1={layout.padding.left} x2={layout.padding.left} y1={layout.padding.top} y2={layout.padding.top + layout.innerHeight} stroke={RULE} />
              {bubbles.map((bubble, index) => {
                const cx = layout.padding.left + clamp01(bubble.x) * layout.innerWidth;
                const cy = layout.padding.top + (1 - clamp01(bubble.y)) * layout.innerHeight;
                const r = Math.max(3, clamp01(bubble.r) * maxRadius);
                return (
                  <g key={bubble.id}>
                    <circle cx={cx} cy={cy} r={r} fill={categoricalColor(index)} fillOpacity={0.5} stroke={categoricalColor(index)}>
                      <title>{bubble.text}</title>
                    </circle>
                    {r > 12 && fits(bubble.label, r * 2) ? <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fill="var(--color-ink)">{bubble.label}</text> : null}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartFrame>
      <p className="flex justify-between gap-2 text-helper text-muted"><span>↑ {yText}</span><span>{xText} →</span></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 小多图（CF-C17）：每个分类一张迷你折线，默认共享纵轴（可比）
// ---------------------------------------------------------------------------

export function SmallMultiplesGrid({ panels, columns, panelHeight, title }: {
  /** `null` = 该时间段未知（例如含缺汇率账目）：折线在此断开，不画成 0。 */
  readonly panels: readonly { readonly id: string; readonly label: string; readonly totalText: string; readonly points: readonly (number | null)[] }[];
  readonly columns: number;
  readonly panelHeight: number;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div className="grid min-h-0 gap-2" style={{ gridTemplateColumns: `repeat(${String(Math.max(1, columns))}, minmax(0, 1fr))` }} role="list" aria-label={title}>
      {panels.map((panel, index) => (
        <div key={panel.id} role="listitem" className="min-w-0">
          <p className="flex items-baseline justify-between gap-1 text-helper">
            <span className="truncate text-ink">{panel.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{panel.totalText}</span>
          </p>
          <ChartFrame height={panelHeight} title={`${panel.label} · ${panel.totalText}`} padding={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            {(layout) => {
              const step = panel.points.length > 1 ? layout.innerWidth / (panel.points.length - 1) : 0;
              let pen = false;
              const d = panel.points.map((value, at) => {
                if (value === null) {
                  pen = false;
                  return "";
                }
                const command = pen ? "L" : "M";
                pen = true;
                return `${command}${String(layout.padding.left + at * step)},${String(layout.padding.top + (1 - clamp01(value)) * layout.innerHeight)}`;
              }).join("");
              return (
                <>
                  <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top + layout.innerHeight} y2={layout.padding.top + layout.innerHeight} stroke={LINE} />
                  <path d={d} fill="none" stroke={categoricalColor(index)} strokeWidth={1.6} strokeLinejoin="round" />
                </>
              );
            }}
          </ChartFrame>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 全年日历（CF-C18）：53 周 × 7 天；无记录、未知、未来与真实金额区分
// ---------------------------------------------------------------------------

export interface YearDay {
  readonly date: string;
  readonly weekIndex: number;
  /** 1 = 周一 … 7 = 周日。 */
  readonly weekday: number;
  readonly state: "complete" | "no-data" | "in-progress" | "future" | "unknown";
  readonly intensity: number;
  readonly text: string;
}

export function YearCalendar({ days, weekCount, monthLabels, height, title }: {
  readonly days: readonly YearDay[];
  readonly weekCount: number;
  readonly monthLabels: readonly { readonly weekIndex: number; readonly label: string }[];
  readonly height: number;
  readonly title: string;
}): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 12, right: 2, bottom: 2, left: 2 }}>
      {(layout) => {
        // 横向铺满 53 周；纵向在高度允许时把格子拉高（最多约 2.5 倍宽），窄屏上也看得清每一天。
        const cell = Math.max(2, layout.innerWidth / Math.max(1, weekCount));
        const cellHeight = Math.max(2, Math.min(layout.innerHeight / 7, cell * 2.5));
        const gap = cell > 6 ? 1 : 0.5;
        const left = layout.padding.left;
        // 月份标签放不下时跳过（不缩小字号）：前一个标签的右端之后才画下一个。
        let lastEnd = -Infinity;
        const shownMonths = monthLabels.filter((month) => {
          const x = left + month.weekIndex * cell;
          if (x < lastEnd + 3) return false;
          lastEnd = x + textUnits(month.label) * 5.4;
          return true;
        });
        return (
          <>
            {shownMonths.map((month) => (
              <text key={month.label} x={left + month.weekIndex * cell} y={9} fontSize={9} fill={MUTED}>{month.label}</text>
            ))}
            {days.map((day) => {
              const fill = day.state === "future" ? "transparent" : day.state === "unknown" ? "var(--color-canvas)" : day.state === "no-data" ? heatColor(0) : heatColor(1 + Math.round(clamp01(day.intensity) * 3));
              return (
                <rect
                  key={day.date}
                  x={left + day.weekIndex * cell + gap / 2}
                  y={layout.padding.top + (day.weekday - 1) * cellHeight + gap / 2}
                  width={Math.max(1, cell - gap)}
                  height={Math.max(1, cellHeight - gap)}
                  rx={cell > 8 ? 1.5 : 0.5}
                  fill={fill}
                  stroke={day.state === "unknown" ? LINE : undefined}
                  strokeDasharray={day.state === "unknown" ? "1 1" : undefined}
                >
                  <title>{day.text}</title>
                </rect>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 斜率图（CF-C20）：左 = 上期，右 = 本期（例如分类占比）
// ---------------------------------------------------------------------------

export function SlopeChart({ leftLabel, rightLabel, rows, height, title }: {
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly rows: readonly { readonly id: string; readonly label: string; readonly left: number | null; readonly right: number | null; readonly leftText: string; readonly rightText: string }[];
  readonly height: number;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <ChartFrame height={height} title={title} padding={{ top: 14, right: 44, bottom: 6, left: 44 }}>
        {(layout) => {
          const xLeft = layout.padding.left;
          const xRight = layout.padding.left + layout.innerWidth;
          const y = (value: number) => layout.padding.top + (1 - clamp01(value)) * layout.innerHeight;
          // 数值标签按纵向位置错开，避免相近的份额叠在一起（点的位置不动，只挪文字）。
          const leftLabels = spreadLabels(rows.map((row) => (row.left === null ? null : y(row.left))), 10, layout.padding.top, layout.padding.top + layout.innerHeight);
          const rightLabels = spreadLabels(rows.map((row) => (row.right === null ? null : y(row.right))), 10, layout.padding.top, layout.padding.top + layout.innerHeight);
          return (
            <>
              <text x={xLeft} y={9} textAnchor="middle" fontSize={10} fill={MUTED}>{leftLabel}</text>
              <text x={xRight} y={9} textAnchor="middle" fontSize={10} fill={MUTED}>{rightLabel}</text>
              <line x1={xLeft} x2={xLeft} y1={layout.padding.top} y2={layout.padding.top + layout.innerHeight} stroke={LINE} />
              <line x1={xRight} x2={xRight} y1={layout.padding.top} y2={layout.padding.top + layout.innerHeight} stroke={LINE} />
              {rows.map((row, index) => {
                const color = categoricalColor(index);
                return (
                  <g key={row.id}>
                    <title>{`${row.label} · ${leftLabel} ${row.leftText} → ${rightLabel} ${row.rightText}`}</title>
                    {row.left !== null && row.right !== null ? <line x1={xLeft} x2={xRight} y1={y(row.left)} y2={y(row.right)} stroke={color} strokeWidth={2} /> : null}
                    {row.left === null ? null : <circle cx={xLeft} cy={y(row.left)} r={3} fill={color} />}
                    {row.right === null ? null : <circle cx={xRight} cy={y(row.right)} r={3} fill={color} />}
                    {leftLabels[index] === null || leftLabels[index] === undefined ? null : <text x={xLeft - 5} y={leftLabels[index] + 3.5} textAnchor="end" fontSize={9} fill={MUTED}>{row.leftText}</text>}
                    {rightLabels[index] === null || rightLabels[index] === undefined ? null : <text x={xRight + 5} y={rightLabels[index] + 3.5} fontSize={9} fill={MUTED}>{row.rightText}</text>}
                  </g>
                );
              })}
            </>
          );
        }}
      </ChartFrame>
      <Legend items={rows.map((row, index) => ({ id: row.id, label: row.label, color: categoricalColor(index) }))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 离散观测点（P18 汇率）：只画真实存在的观测，不插值、不连成「完整行情」
// ---------------------------------------------------------------------------

export function ObservationDots({ points, height, title, minText, maxText }: {
  readonly points: readonly { readonly id: string; readonly x: number; readonly y: number; readonly text: string }[];
  readonly height: number;
  readonly title: string;
  readonly minText: string;
  readonly maxText: string;
}): React.JSX.Element {
  return (
    <ChartFrame height={height} title={title} padding={{ top: 12, right: 8, bottom: 12, left: 8 }}>
      {(layout) => (
        <>
          <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top} y2={layout.padding.top} stroke={LINE} strokeDasharray="2 3" />
          <line x1={layout.padding.left} x2={layout.padding.left + layout.innerWidth} y1={layout.padding.top + layout.innerHeight} y2={layout.padding.top + layout.innerHeight} stroke={LINE} strokeDasharray="2 3" />
          <text x={layout.padding.left} y={layout.padding.top - 3} fontSize={9} fill={MUTED}>{maxText}</text>
          <text x={layout.padding.left} y={layout.height - 1} fontSize={9} fill={MUTED}>{minText}</text>
          {points.map((point) => (
            <circle key={point.id} cx={layout.padding.left + clamp01(point.x) * layout.innerWidth} cy={layout.padding.top + (1 - clamp01(point.y)) * layout.innerHeight} r={3} fill={BRAND}>
              <title>{point.text}</title>
            </circle>
          ))}
        </>
      )}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 数据表（CF-10 / CF-C01 / CF-C16）：任何图表的可访问兜底形态
// ---------------------------------------------------------------------------

export function DataTable({ columns, rows, limit, moreText, title, footer }: {
  readonly columns: readonly { readonly label: string; readonly align?: "left" | "right" }[];
  readonly rows: readonly { readonly key: string; readonly cells: readonly string[] }[];
  readonly limit: number;
  readonly moreText: (count: number) => string;
  readonly title: string;
  readonly footer?: readonly string[];
}): React.JSX.Element {
  const shown = rows.slice(0, Math.max(1, limit));
  const hidden = rows.length - shown.length;
  return (
    <div className="sw-interactive min-h-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabIndex={0} aria-label={title} onClick={(event) => event.stopPropagation()}>
      <table className="w-full text-helper tabular-nums" aria-label={title}>
        <thead>
          <tr className="text-muted">
            {columns.map((column, index) => (
              <th key={index} scope="col" className={`px-1 py-0.5 font-normal whitespace-nowrap ${column.align === "right" ? "text-right" : "text-left"}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.key} className="border-t border-line">
              {row.cells.map((cell, index) => (
                <td key={index} className={`max-w-[9rem] truncate px-1 py-0.5 ${columns[index]?.align === "right" ? "text-right text-ink" : "text-left text-ink"}`} title={cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer === undefined ? null : (
          <tfoot>
            <tr className="border-t border-line font-medium">
              {footer.map((cell, index) => (
                <td key={index} className={`px-1 py-0.5 ${columns[index]?.align === "right" ? "text-right" : "text-left"}`}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {hidden > 0 ? <p className="text-helper text-muted">{moreText(hidden)}</p> : null}
    </div>
  );
}
