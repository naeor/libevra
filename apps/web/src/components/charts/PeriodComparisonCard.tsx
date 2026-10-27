/**
 * 上期收支比较的数字卡（A01–A03、A05；CF-B10）。
 *
 * **只做排版。** 本组件不计算任何金额——每段文字（精确金额、差额、增长率、
 * 不可用原因、对比口径）都由调用方从 `@libellum/shared` 的
 * `computePeriodComparison` 结果格式化后传入，组件只把它摆成可读的对比。
 *
 * 展示约定（§19–§23、CF-B10）：
 *
 *  * 必须同时显示**两个真实日期区间**，不能只给一个百分比；
 *  * 涨跌**不上色为好坏**：支出上涨不是红色“坏”，支出下降也不是绿色“好”；
 *  * 增长率不可用时显示原因（上期为 0、上期为负、覆盖未知），而不是空白；
 *  * 观察窗口不等长时把 `rangeNoteText` 显示在数字旁边。
 */
export interface ComparisonCardMetric {
  /** 指标名（支出/收入），本地化文字。 */
  readonly label: string;
  /** 本期精确金额，含币种；未知时为 null。 */
  readonly currentText: string | null;
  /** 上期精确金额，含币种；未知时为 null。 */
  readonly previousText: string | null;
  /** 带符号的精确差额；不可计算时为 null。 */
  readonly differenceText: string | null;
  /** 已格式化的相对变化（如 “+20%”）；不可用时为 null。 */
  readonly growthText: string | null;
  /** 增长率不可用时的原因文字（如 “上期为 0，无法计算”）。 */
  readonly growthUnavailableText: string | null;
  /** 两侧观察窗口是否都有完整数据。 */
  readonly complete: boolean;
}

export interface PeriodComparisonCardProps {
  readonly title: string;
  /** 本期真实观测区间，如 “10月1日–10月27日”。 */
  readonly currentRangeText: string;
  /** 上期真实对比区间；无上期（首次使用）时为 null。 */
  readonly previousRangeText: string | null;
  /** 观察窗口不等长的说明；等长时为 null。 */
  readonly rangeNoteText: string | null;
  readonly metrics: readonly ComparisonCardMetric[];
  /** 对比口径说明（总有值）：是“上一个完整月”还是“上个月同期”等。 */
  readonly methodText: string;
}

export function PeriodComparisonCard({
  title,
  currentRangeText,
  previousRangeText,
  rangeNoteText,
  metrics,
  methodText,
}: PeriodComparisonCardProps): React.JSX.Element {
  return (
    <section
      data-testid="period-comparison-card"
      className="rounded-card bg-surface p-4 text-caption"
    >
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-muted">
        <span data-testid="comparison-current-range">{currentRangeText}</span>
        {previousRangeText === null ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <span data-testid="comparison-previous-range">{previousRangeText}</span>
          </>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {metrics.map((metric) => (
          <div key={metric.label} data-metric={metric.label} className="col-span-2 sm:col-span-1">
            <dt className="text-muted">{metric.label}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span data-testid={`comparison-current-${metric.label}`} className="text-body font-semibold indent-0">
                {metric.currentText ?? "—"}
              </span>
              <span className="text-muted">→</span>
              <span data-testid={`comparison-previous-${metric.label}`} className="text-muted">
                {metric.previousText ?? "—"}
              </span>
            </dd>
            <dd className="mt-1 text-muted">
              {metric.differenceText === null ? null : (
                <span data-testid={`comparison-difference-${metric.label}`}>
                  {metric.differenceText}
                </span>
              )}
              {metric.growthText === null ? null : (
                <span data-testid={`comparison-growth-${metric.label}`} className="ml-2 font-medium text-ink">
                  {metric.growthText}
                </span>
              )}
              {metric.growthText === null && metric.growthUnavailableText !== null ? (
                <span data-testid={`comparison-growth-unavailable-${metric.label}`} className="ml-2">
                  {metric.growthUnavailableText}
                </span>
              ) : null}
              {metric.complete ? null : (
                <span data-testid={`comparison-incomplete-${metric.label}`} className="ml-2">
                  ⚠
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {rangeNoteText === null ? null : (
        <p data-testid="comparison-range-note" className="mt-3 text-muted">
          {rangeNoteText}
        </p>
      )}
      <p data-testid="comparison-method" className="mt-2 text-helper text-muted">
        {methodText}
      </p>
    </section>
  );
}
