import { HistoryList } from "../components/HistoryList.js";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { useLedger } from "../lib/queries.js";

/**
 * **完整编辑历史。**
 *
 * ⚠️ **The owner asked for the preview and the full view to be two things**:
 * *"主页面可以预览最近几条历史，并提供入口查看更完整的记录."*
 *
 * ⚠️ **A separate screen rather than "show more" on the ledger page**, because the ledger page has
 * four other sections and **a list that grows without limit would push all of them off the bottom.**
 * The history is the one thing here whose length is not bounded by its own subject.
 *
 * ⚠️ **200 is the API's cap, not a choice made here** — see the route: an uncapped `limit` is a
 * request that reads the whole ledger, **which is the rule the export pagination exists for.** When a
 * ledger passes 200 changes the honest next step is paging, not a larger number.
 */
export function LedgerHistoryPage(): React.JSX.Element {
  const ledger = useLedger();
  const { t } = useI18n();

  return (
    <InnerPage
      title={t("ledger.history.pageTitle")}
      subtitle={ledger.data?.book.name ?? t("ledger.history.loadingBook")}
      backTo="/ledger"
    >
      <HistoryList
        limit={200}
        emptyHint={t("ledger.page.historyEmpty")}
      />

      <p className="mt-4 text-helper-relaxed text-muted">
        {t("ledger.history.pageHint")}
      </p>
    </InnerPage>
  );
}
