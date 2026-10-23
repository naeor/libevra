import { HistoryList } from "../components/HistoryList.js";
import { InnerPage } from "../components/Layouts.js";
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

  return (
    <InnerPage
      title="编辑历史"
      subtitle={ledger.data?.book.name ?? "正在读取当前账本……"}
      backTo="/ledger"
    >
      <HistoryList
        limit={200}
        emptyHint="暂无编辑记录。此功能启用前的操作不在记录中。"
      />

      <p className="mt-4 text-helper-relaxed text-muted">
        点按账目记录查看详情，点按编号复制。
      </p>
    </InnerPage>
  );
}
