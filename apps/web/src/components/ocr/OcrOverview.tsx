/**
 * 批量识别结果的概览（S15-B §3.2/§3.3）。
 *
 * 组件只展示、不编辑、不写账：
 *  - 顶部先给一行数字（识别总数/待核对/疑似重复/可导入），其余口径收进「详情」；
 *  - 主筛选只留状态，来源与方向收进可折叠面板，能力一个都不少；
 *  - 每笔一张横向卡片：状态与日期来源一行，金额/币种/方向一层，分类/支付方式等辅助
 *    信息一层；只有真的有疑问才出现警告；
 *  - 底部固定操作条由页面渲染（`OcrImportBar`），确认仍走页面原有的 import 流程；
 *  - 汇总数字全部由传入的候选计算（`lib/ocr/types.ts`、`lib/ocr/import.ts` 的纯函数），
 *    和列表同一口径；缺失字段显示「待确认」，不伪造默认值；疑似重复只提示，不合并、不删除。
 */

import {
  type Category,
  type OcrChannel,
  type OcrDirection,
  type OcrIssue,
  type PaymentMethod,
  type Tag,
} from "@libellum/shared";
import { Trans } from "react-i18next";

import { isChineseLocale, t as translate, useI18n } from "../../i18n/index.js";
import type zhOcr from "../../i18n/resources/zh-CN/ocr.js";
import { displayCategoryName, displayPaymentMethodName } from "../../lib/presetNames.js";
import { groupsForCandidate, type OcrDuplicateGroup } from "../../lib/ocr/duplicates.js";
import { validationBlocker, type OcrImportBlocker } from "../../lib/ocr/import.js";
import {
  categorySourceOf,
  deriveIssues,
  itemStatus,
  type OcrBatchCandidate,
  type OcrBatchCounts,
  type OcrDirectionFilter,
  type OcrItemStatus,
  type OcrOverviewFilter,
  type OcrSourceFilter,
} from "../../lib/ocr/types.js";

/** 折叠面板的 id；`aria-controls` 与它对应。 */
export const OCR_OVERVIEW_FILTERS_ID = "ocr-overview-filters";

export interface OcrOverviewProps {
  /** 已按当前筛选条件过滤后的候选。 */
  readonly items: readonly OcrBatchCandidate[];
  /** 全部候选的计数（筛选不改变汇总）。 */
  readonly counts: OcrBatchCounts;
  /**
   * 通过导入字段校验的笔数（`countImportableItems`）。
   *
   * 与 `counts.valid` 的区别：valid 是“用户没有排除”，这里才是“现在写进去不会失败”。
   * 顶部和底部条都用这个数，避免按钮被禁用时还写着“可导入 5 笔”。
   */
  readonly importableCount: number;
  readonly filter: OcrOverviewFilter;
  readonly onFilterChange: (filter: OcrOverviewFilter) => void;
  readonly source: OcrSourceFilter;
  readonly onSourceChange: (source: OcrSourceFilter) => void;
  readonly direction: OcrDirectionFilter;
  readonly onDirectionChange: (direction: OcrDirectionFilter) => void;
  /** 来源/方向筛选面板是否展开（由页面持有，便于测试静态渲染）。 */
  readonly filtersOpen: boolean;
  readonly onToggleFilters: () => void;
  /** 批次里出现过的来源，来自全部候选而不是当前筛选结果。 */
  readonly sources: readonly OcrChannel[];
  readonly duplicateGroups: readonly OcrDuplicateGroup[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly onOpenDetail: (candidateId: string) => void;
  /** 批次级的风险提醒（例如属于另一本账本、有截图没切出候选）。 */
  readonly warnings?: readonly string[];
  /** 存储与临时性说明，收在「详情」里；组件不假设批次来自哪里。 */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// 按代码翻译的标签（S16）。shared 的 `OCR_CHANNEL_LABELS` / `OCR_DIRECTION_LABELS` 是中文，
// 这里按代码取当前界面语言的说法；单笔核对页也用这几个函数。
// ---------------------------------------------------------------------------

type OcrIssueCode = keyof typeof zhOcr.issue;

const OCR_ISSUE_CODES: ReadonlySet<string> = new Set<OcrIssueCode>([
  "missing_amount",
  "missing_date",
  "missing_time",
  "missing_merchant",
  "missing_currency",
  "missing_year",
  "year_inferred",
  "relative_date",
  "direction_unclear",
  "amount_uncertain",
  "amount_conflict",
  "amount_unreadable",
  "duplicate_suspected",
  "layout_unverified",
  "layout_conflict",
  "extraction_incomplete",
  "currency_assumed",
  "order_closed",
  "date_hint",
]);

/** 来源平台的说法（`OCR_CHANNEL_LABELS` 的界面语言版本）。 */
export function ocrChannelLabel(channel: OcrChannel): string {
  return translate(`ocr.channel.${channel}`);
}

/** 收支方向的说法（`OCR_DIRECTION_LABELS` 的界面语言版本）。 */
export function ocrDirectionLabel(direction: OcrDirection): string {
  return translate(`ocr.direction.${direction}`);
}

/**
 * 一条识别问题的说明。
 *
 * ⚠️ 问题文字来自识别服务（Python），是中文原文且常带具体细节：中文界面**原样显示**；其它语言
 * 按问题代码显示通用说明（`ocr.issue.*`），不认识的代码显示一句通用提示——不把中文塞进英文界面。
 */
export function ocrIssueText(issue: Pick<OcrIssue, "code" | "message">): string {
  if (isChineseLocale()) return issue.message;
  return OCR_ISSUE_CODES.has(issue.code)
    ? translate(`ocr.issue.${issue.code as OcrIssueCode}`)
    : translate("ocr.issueFallback");
}

const STATUS_CLASSES: Readonly<Record<OcrItemStatus, string>> = {
  recognized: "bg-brand-soft text-brand-dark",
  review: "bg-warn-soft text-warn-dark",
  duplicate: "bg-warn-soft text-warn-dark",
  invalid: "bg-canvas text-muted",
};

function fieldText(value: string | null, fallback: string): string {
  return value === null || value.trim() === "" ? fallback : value;
}

function amountText(item: OcrBatchCandidate): string {
  return fieldText(item.amount, translate("ocr.list.amountPending"));
}

function currencyText(item: OcrBatchCandidate): string {
  return fieldText(item.currency, translate("ocr.list.currencyPending"));
}

/** 日期与时间按识别出的原样（`YYYY-MM-DD HH:mm`）显示：这是用户要核对的值，与编辑框一致。 */
function dateTimeText(item: OcrBatchCandidate): string {
  if (item.occurredLocalDate === null) return translate("ocr.list.datePending");
  return item.occurredTime === null
    ? item.occurredLocalDate
    : `${item.occurredLocalDate} ${item.occurredTime}`;
}

function sourceText(item: OcrBatchCandidate): string {
  return item.sourcePlatform === null ? translate("ocr.list.sourcePending") : ocrChannelLabel(item.sourcePlatform);
}

/**
 * 分类的文字。系统按交易对象/备注猜出来的值必须带「系统建议」，不能和用户选过的
 * 混成同一句话；旧批次没有来源字段时按“平台默认”处理（见 `categorySourceOf`）。
 */
function categoryText(
  item: OcrBatchCandidate,
  categories: readonly Category[],
): string {
  if (item.categoryId === null) return translate("ocr.list.uncategorized");
  const name = categories.find((category) => category.id === item.categoryId)?.name;
  if (name === undefined) return translate("ocr.list.uncategorized");
  const shown = displayCategoryName(name);
  return categorySourceOf(item) === "inferred" ? translate("ocr.list.suggested", { name: shown }) : shown;
}

function paymentText(
  item: OcrBatchCandidate,
  methods: readonly PaymentMethod[],
): string {
  if (item.paymentMethodId === null) return translate("ocr.list.paymentPending");
  const name = methods.find((method) => method.id === item.paymentMethodId)?.name;
  return name === undefined ? translate("ocr.list.paymentPending") : displayPaymentMethodName(name);
}

/** 没有标签就整段省略，而不是写“无标签”占一行。标签名是用户数据，原样显示。 */
function tagText(item: OcrBatchCandidate, tags: readonly Tag[]): string | null {
  if (item.tagIds.length === 0) return null;
  const names = item.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return names.length === 0 ? null : names.join(translate("ocr.listSeparator"));
}

/** 次级筛选是否生效；用于「筛选 · N」与“已筛选”提示。 */
function secondaryFilterCount(source: OcrSourceFilter, direction: OcrDirectionFilter): number {
  return (source === "all" ? 0 : 1) + (direction === "all" ? 0 : 1);
}

function secondaryFilterText(
  source: OcrSourceFilter,
  direction: OcrDirectionFilter,
): string {
  const parts: string[] = [];
  if (source !== "all") parts.push(translate("ocr.list.sourceFilter", { source: ocrChannelLabel(source) }));
  if (direction !== "all") {
    parts.push(direction === "expense" ? translate("ocr.list.expenseOnly") : translate("ocr.list.incomeOnly"));
  }
  return parts.join(translate("ocr.list.filterSeparator"));
}

function primaryFilterText(filter: OcrOverviewFilter): string {
  return translate(`ocr.list.primary.${filter}`);
}

/** 当前空列表的筛选说明；没有任何次级筛选时为空串。 */
function activeFilterText(
  filter: OcrOverviewFilter,
  source: OcrSourceFilter,
  direction: OcrDirectionFilter,
): string {
  const parts = [primaryFilterText(filter)];
  const secondary = secondaryFilterText(source, direction);
  if (secondary !== "") parts.push(secondary);
  return parts.join(translate("ocr.list.filterSeparator"));
}

export function OcrOverview({
  items,
  counts,
  importableCount,
  filter,
  onFilterChange,
  source,
  onSourceChange,
  direction,
  onDirectionChange,
  filtersOpen,
  onToggleFilters,
  sources,
  duplicateGroups,
  categories,
  paymentMethods,
  tags,
  onOpenDetail,
  warnings,
  note,
}: OcrOverviewProps): React.JSX.Element {
  const { t } = useI18n();
  const extras = secondaryFilterCount(source, direction);
  const filterDetail = activeFilterText(filter, source, direction);

  function clearSecondaryFilters(): void {
    onSourceChange("all");
    onDirectionChange("all");
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label={t("ocr.list.summaryLabel")}
        className="rounded-card border border-line bg-surface px-4 py-3 shadow-card"
      >
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <SummaryInline label={t("ocr.list.recognized")} value={counts.total} />
          <SummaryInline label={t("ocr.list.pending")} value={counts.pending} tone="warning" />
          <SummaryInline label={t("ocr.list.duplicates")} value={counts.duplicates} tone="warning" />
          <SummaryInline label={t("ocr.list.importable")} value={importableCount} tone="brand" />
        </dl>

        <details className="mt-1.5">
          <summary className="w-fit cursor-pointer select-none text-helper text-muted">
            {t("ocr.list.countsHelp")}
          </summary>

          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <SummaryNumber label={t("ocr.list.valid")} value={counts.valid} />
            <SummaryNumber label={t("ocr.list.confirmed")} value={counts.confirmed} />
            <SummaryNumber label={t("ocr.list.invalid")} value={counts.invalid} />
            <SummaryNumber label={t("ocr.list.reviewed")} value={counts.reviewed} />
          </dl>

          <ul className="mt-2 flex flex-col gap-1 text-helper text-muted">
            <li>{t("ocr.list.helpRecognized")}</li>
            <li>{t("ocr.list.helpPending")}</li>
            <li>{t("ocr.list.helpReviewed")}</li>
            <li>{t("ocr.list.helpFilters")}</li>
          </ul>

          {note === undefined ? null : <p className="mt-2 text-helper text-muted">{note}</p>}
        </details>
      </section>

      {warnings === undefined || warnings.length === 0 ? null : (
        <ul aria-label={t("ocr.list.warningsLabel")} className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-helper-relaxed text-warn-dark">
              ⚠ {warning}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("ocr.list.statusFilterLabel")}>
        <FilterButton
          active={filter === "all"}
          label={t("ocr.list.chipAll", { count: counts.total })}
          onSelect={() => {
            onFilterChange("all");
          }}
        />
        <FilterButton
          active={filter === "pending"}
          label={t("ocr.list.chipPending", { count: counts.pending })}
          onSelect={() => {
            onFilterChange("pending");
          }}
        />
        <FilterButton
          active={filter === "duplicates"}
          label={t("ocr.list.chipDuplicates", { count: counts.duplicates })}
          onSelect={() => {
            onFilterChange("duplicates");
          }}
        />
        <FilterButton
          active={filter === "confirmed"}
          label={t("ocr.list.chipConfirmed", { count: counts.confirmed })}
          onSelect={() => {
            onFilterChange("confirmed");
          }}
        />
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={OCR_OVERVIEW_FILTERS_ID}
          onClick={onToggleFilters}
          className={`rounded-full border px-3 py-1.5 text-helper transition ${
            filtersOpen || extras > 0
              ? "border-brand bg-brand-soft text-brand-dark"
              : "border-line bg-surface text-muted"
          }`}
        >
          {extras === 0 ? t("ocr.list.filter") : t("ocr.list.filterCount", { count: extras })}
        </button>
      </div>

      {filtersOpen ? (
        <div
          id={OCR_OVERVIEW_FILTERS_ID}
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card"
        >
          {sources.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
              <span className="text-helper text-muted">{t("ocr.list.source")}</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("ocr.list.sourceFilterLabel")}>
                <FilterButton
                  active={source === "all"}
                  label={t("ocr.list.allSources")}
                  onSelect={() => {
                    onSourceChange("all");
                  }}
                />
                {sources.map((value) => (
                  <FilterButton
                    key={value}
                    active={source === value}
                    label={ocrChannelLabel(value)}
                    onSelect={() => {
                      onSourceChange(value);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-helper text-muted">{t("ocr.list.direction")}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("ocr.list.directionFilterLabel")}>
              <FilterButton
                active={direction === "all"}
                label={t("ocr.list.allDirections")}
                onSelect={() => {
                  onDirectionChange("all");
                }}
              />
              <FilterButton
                active={direction === "expense"}
                label={t("common.kind.expense")}
                onSelect={() => {
                  onDirectionChange("expense");
                }}
              />
              <FilterButton
                active={direction === "income"}
                label={t("common.kind.income")}
                onSelect={() => {
                  onDirectionChange("income");
                }}
              />
            </div>
          </div>

          {extras === 0 ? null : (
            <button
              type="button"
              onClick={clearSecondaryFilters}
              className="self-start text-left text-helper text-brand-dark underline-offset-2 hover:underline"
            >
              {t("ocr.list.clearSecondary")}
            </button>
          )}
        </div>
      ) : extras === 0 ? null : (
        <p className="text-helper text-muted">
          {t("ocr.list.filtered", { filters: secondaryFilterText(source, direction) })}
          <button
            type="button"
            onClick={clearSecondaryFilters}
            className="ml-2 text-brand-dark underline-offset-2 hover:underline"
          >
            {t("ocr.list.clear")}
          </button>
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-body text-muted">
            {counts.total === 0
              ? t("ocr.list.nothingExtracted")
              : t("ocr.list.noMatch")}
          </p>
          {counts.total === 0 ? null : (
            <>
              <p className="mt-1 text-helper text-muted">{t("ocr.list.currentFilters", { filters: filterDetail })}</p>
              <button
                type="button"
                onClick={() => {
                  onFilterChange("all");
                  clearSecondaryFilters();
                }}
                className="mt-2 text-helper text-brand-dark underline-offset-2 hover:underline"
              >
                {t("ocr.list.showAll")}
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.candidateId}>
              <OcrOverviewCard
                item={item}
                duplicateGroups={duplicateGroups}
                categories={categories}
                paymentMethods={paymentMethods}
                tags={tags}
                onOpenDetail={onOpenDetail}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SummaryInline({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "default" | "warning" | "brand";
}): React.JSX.Element {
  const toneClass =
    tone === "warning" ? "text-warn-dark" : tone === "brand" ? "text-brand-dark" : "text-ink";

  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-helper text-muted">{label}</dt>
      <dd className={`text-body font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

function SummaryNumber({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-helper text-muted">{label}</dt>
      <dd className="text-body text-ink">{value}</dd>
    </div>
  );
}

export function FilterButton({
  active,
  label,
  onSelect,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`min-h-11 rounded-full border px-3 py-1.5 text-helper transition ${
        active ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function OcrOverviewCard({
  item,
  duplicateGroups,
  categories,
  paymentMethods,
  tags,
  onOpenDetail,
}: {
  readonly item: OcrBatchCandidate;
  readonly duplicateGroups: readonly OcrDuplicateGroup[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly onOpenDetail: (candidateId: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const status = itemStatus(item);
  const issues = deriveIssues(item);
  const groups = groupsForCandidate(duplicateGroups, item.candidateId);
  const importBlocker = validationBlocker(item);
  const labels = tagText(item, tags);

  /**
   * ⚠️ 一条“已识别”的记录却写不进账（例如币种账本不支持）时，卡片必须自己说出来。
   * 状态为待核对/疑似重复时，缺字段与重复本身已经有提示，不再叠一条同义的警告。
   */
  const showImportBlocker = importBlocker !== null && status === "recognized";

  return (
    <article
      className={`flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3 shadow-card ${
        item.invalid ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-helper ${STATUS_CLASSES[status]}`}>
            {t(`ocr.status.${status}`)}
          </span>
          {item.isRefund ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
              {t("ocr.list.refund")}
            </span>
          ) : null}
          {item.isTransfer ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
              {t("ocr.list.transfer")}
            </span>
          ) : null}
          {item.reviewed && !item.invalid ? (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">{t("ocr.list.reviewedBadge")}</span>
          ) : null}
        </span>

        <span className="text-helper text-muted">
          {dateTimeText(item)} · {sourceText(item)}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-section-title text-ink">{amountText(item)}</span>
        <span className="text-helper text-muted">{currencyText(item)}</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
          {ocrDirectionLabel(item.direction)}
        </span>
      </div>

      <p className="break-words text-body text-ink">{fieldText(item.merchant, t("ocr.list.merchantPending"))}</p>

      {/* S16：说明文字 `min-w-0` + 允许断行，英文较长时不把「查看详情」挤出卡片。 */}
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 text-helper text-muted [overflow-wrap:anywhere]">
          {[
            t("ocr.list.cardCategory", { value: categoryText(item, categories) }),
            t("ocr.list.cardPayment", { value: paymentText(item, paymentMethods) }),
            ...(labels === null ? [] : [t("ocr.list.cardTags", { value: labels })]),
            ...(item.account === null || item.account.trim() === ""
              ? []
              : [t("ocr.list.cardAccount", { value: item.account.trim() })]),
          ].join(" · ")}
        </p>
        <button
          type="button"
          onClick={() => {
            onOpenDetail(item.candidateId);
          }}
          className="shrink-0 rounded-field px-2 py-1 text-link text-brand-dark underline-offset-2 hover:underline"
        >
          {t("ocr.list.viewDetails")}
        </button>
      </div>

      {item.note === null || item.note.trim() === "" ? null : (
        <p className="truncate text-helper text-muted">{t("ocr.list.cardNote", { value: item.note.trim() })}</p>
      )}

      {groups.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.groupId} className="text-helper-relaxed text-warn-dark">
              {t("ocr.list.possibleDuplicate", { reason: group.reason })}
            </li>
          ))}
        </ul>
      )}

      {issues.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.field ?? ""}`}
              className="text-helper-relaxed text-warn-dark"
            >
              ⚠ {ocrIssueText(issue)}
            </li>
          ))}
        </ul>
      )}

      {showImportBlocker ? (
        <p className="text-helper-relaxed text-warn-dark">{t("ocr.list.cannotImport", { reason: importBlocker })}</p>
      ) : null}

      {item.invalid ? (
        <p className="text-helper text-muted">{t("ocr.list.markedInvalid")}</p>
      ) : null}
    </article>
  );
}

/**
 * 底部固定操作条：可导入数量 + 确认入口。
 *
 * ⚠️ **它只是入口。** 确认后仍然由页面调用 `executeImport`/`createEntry`（既有本地写入与
 * 离线队列、幂等、撤销、权限都不变）；这个组件不 import 任何写账函数，也不写 sessionStorage。
 *
 * ⚠️ **安全区在这里处理**（`pb-[env(safe-area-inset-bottom)]`），因为 OCR 概览页没有底部
 * 导航；页面在列表末尾留出等高空白，最后一笔不会被这条 bar 盖住。
 */
export function OcrImportBar({
  importableCount,
  blockedReason,
  blockers,
  busy,
  onConfirm,
  onCancel,
  cancelLabel,
}: {
  readonly importableCount: number;
  /** 不能导入的原因（权限、账本不符、字段不够……）；`null` 表示可以确认。 */
  readonly blockedReason: string | null;
  /** 逐笔阻塞原因，展开可见；不隐藏任何一笔。 */
  readonly blockers: readonly OcrImportBlocker[];
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** 默认「取消这次识别」（当前界面语言）。 */
  readonly cancelLabel?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const disabled = importableCount === 0 || blockedReason !== null || busy;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-card">
      <div className="mx-auto w-full max-w-md px-6 pt-2.5 pb-3">
        {/* S16：英文的按钮文字更长（“Import 12 entries”），计数允许收缩换行，按钮保持一行。 */}
        <div className="flex items-center gap-3">
          <p className="mr-auto min-w-0 text-helper-relaxed text-ink">
            <Trans
              i18nKey="ocr.bar.importable"
              count={importableCount}
              values={{ count: importableCount }}
              components={{ b: <strong className="font-semibold" /> }}
            />
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="shrink-0 rounded-field bg-brand px-4 py-2.5 text-button-lg font-medium text-on-brand shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? t("ocr.bar.importing") : t("ocr.bar.confirm", { count: importableCount })}
          </button>
        </div>

        <div className="mt-1 flex items-start justify-between gap-3">
          <p
            className={`min-w-0 text-helper ${blockedReason === null ? "text-muted" : "text-warn-dark"}`}
          >
            {blockedReason ?? t("ocr.bar.nothingWritten")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="shrink-0 text-helper text-muted underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-45"
          >
            {cancelLabel ?? t("ocr.bar.cancel")}
          </button>
        </div>

        {blockers.length === 0 ? null : (
          <details className="mt-1">
            <summary className="w-fit cursor-pointer select-none text-helper text-warn-dark">
              {t("ocr.bar.blockers", { count: blockers.length })}
            </summary>
            <ul className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto">
              {blockers.map((entry) => (
                <li key={entry.candidateId} className="text-helper-relaxed text-warn-dark">
                  {t("ocr.bar.blocker", { label: entry.label, reason: entry.reason })}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
