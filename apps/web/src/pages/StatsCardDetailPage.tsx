/**
 * 分析卡片实例详情（卡片规格 §8；D 层）：**继承被点击那张卡片的配置**，而不是按图表类型打开通用页。
 *
 * - 条件：沿用工作台地址栏里的生效筛选（时间、币种、原币 / 综合），卡片固定的区间或自带窗口优先；
 *   详情里不改筛选，所以返回后工作台状态原样恢复（滚动位置与焦点由分析页记录）；
 * - 内容：同一份计算结果的完整密度版本（排行显示全部项，不折叠）；
 * - 依据：计算来源、数据来源（本机当前账本）与覆盖提示；可以进入对应月份的账目列表。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import { useLedger } from "../lib/queries.js";
import { CardBody, cardRange, cardSubtitle, cardTitle } from "../statsWorkbench/cards.js";
import { cardType } from "../statsWorkbench/catalog.js";
import { CompositeDetail } from "../statsWorkbench/CompositeCard.js";
import { isMultiSlot, readComposition } from "../statsWorkbench/composition.js";
import { readFilters } from "../statsWorkbench/filters.js";
import { useWorkbenchScope, WorkbenchScopeProvider } from "../statsWorkbench/scope.js";
import { readStored } from "../statsWorkbench/storage.js";
import { SourceEntries } from "../statsWorkbench/SourceEntries.js";
import { WORKBENCH_INSTALLED } from "../statsWorkbench/configEvents.js";

export function StatsCardDetailPage(): React.JSX.Element {
  const { t } = useI18n();
  const { objectId = "" } = useParams();
  const [params] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const scope = useWorkbenchScope(filters);
  const ledger = useLedger();
  const [configurationRevision, setConfigurationRevision] = useState(0);
  useEffect(() => {
    const installed = (event: Event) => { if ((event as CustomEvent<string>).detail === scope.accountScope) setConfigurationRevision(value => value + 1); };
    window.addEventListener(WORKBENCH_INSTALLED, installed);
    return () => window.removeEventListener(WORKBENCH_INSTALLED, installed);
  }, [scope.accountScope]);
  const documents = useMemo(() => readStored(scope.accountScope).documents, [scope.accountScope, configurationRevision]);
  const card = documents.content.cards.find((item) => item.objectId === objectId);
  const search = params.toString();
  const backTo = `/stats${search === "" ? "" : `?${search}`}`;

  if (card === undefined) {
    return (
      <InnerPage title={t("statsWorkbench.detail.missingTitle")} backTo={backTo}>
        <p className="text-body-relaxed text-muted">{t("statsWorkbench.detail.missing")}</p>
      </InnerPage>
    );
  }

  const type = cardType(card.analysis.analysisId);
  const range = cardRange(card, scope);
  const month = range.to.slice(0, 7);

  return (
    <WorkbenchScopeProvider value={scope}>
      <InnerPage title={cardTitle(card, t)} subtitle={cardSubtitle(card, scope, t)} backTo={backTo}>
        <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4" aria-label={t("statsWorkbench.detail.conditions")}>
          <p className="text-helper text-muted">
            {t("statsWorkbench.detail.range", { from: formatLocalDate(range.from), to: formatLocalDate(range.to) })}
          </p>
          <p className="text-helper text-muted">
            {t("statsWorkbench.detail.currency", {
              currency: scope.combined ? t("statsWorkbench.summary.combined", { currency: scope.currency }) : currencyName(scope.currency),
            })}
          </p>
          <p className="text-helper text-muted">{t("statsWorkbench.detail.ledger", { name: ledger.data?.book.name ?? "—" })}</p>
          {type?.ownWindow === "12m" ? <p className="text-helper text-muted">{t("statsWorkbench.config.ownWindow")}</p> : null}
        </section>

        {isMultiSlot(card) ? (
          // 组合卡片：每项内容一节，完整密度（卡片上放不下而收起的内容在这里全部显示）。
          <CompositeDetail card={card} scope={scope} />
        ) : (
          <section className="min-h-0 rounded-card border border-line bg-surface p-4" aria-label={cardTitle(card, t)}>
            {/* 详情不改筛选（返回后工作台原样恢复），所以这里不提供「改用原币」之类的动作。 */}
            <CardBody card={card} scope={scope} density="expanded" detail />
            <SourceEntries card={card} scope={scope} />
          </section>
        )}

        {scope.coverageGap !== null ? (
          <p role="status" className="rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-ink">
            {t("statsWorkbench.coverage.gap", { server: scope.coverageGap.server, local: scope.coverageGap.local })}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <div>
            <h2 className="text-card-title text-ink">{t("statsWorkbench.detail.method")}</h2>
            {isMultiSlot(card) ? (
              <ul className="mt-1 flex flex-col gap-1 text-helper-relaxed text-muted">
                {readComposition(card).slots.map((slot) => {
                  const slotType = cardType(slot.analysisId);
                  return (
                    <li key={slot.id}>
                      {slotType === null ? t("statsWorkbench.card.unknownHint") : `${t(`statsWorkbench.cards.${slotType.id as "AN-B01"}.title`)}：${t(`statsWorkbench.detail.methods.${slotType.source}`)} · ${slotType.id}`}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-helper-relaxed text-muted">
                {type === null ? t("statsWorkbench.card.unknownHint") : t(`statsWorkbench.detail.methods.${type.source}`)}
                {type === null ? "" : ` · ${type.id}`}
              </p>
            )}
          </div>
          <div>
            <h2 className="text-card-title text-ink">{t("statsWorkbench.detail.source")}</h2>
            <p className="mt-1 text-helper-relaxed text-muted">
              {scope.combined ? t("statsWorkbench.detail.sourceCombined") : t("statsWorkbench.detail.sourceLocal")}
            </p>
          </div>
          <Link to={`/?month=${month}`} className="self-start text-link text-brand-dark underline">
            {t("statsWorkbench.detail.viewEntries", { month: formatLocalDate(`${month}-01`, { year: "numeric", month: "long" }) })}
          </Link>
        </section>
      </InnerPage>
    </WorkbenchScopeProvider>
  );
}
