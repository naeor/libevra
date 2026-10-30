/**
 * **只作用于设备当前账本的页面，在「外部账本」工作区里的出口**（S18 第二轮 · 账本隔离）。
 *
 * 拍照 / 语音 / 粘贴记账、导入导出、离线下载这些页面读写的是**设备当前账本**（离线副本、同步队列、
 * 请求头默认值）。工作区查看的是另一本账时，直接显示它们会出现「标题是 A 账、实际写进 B 账」——
 * 这正是账本隔离要杜绝的。所以这里不渲染页面本身，只说明原因，并给出唯一有用的下一步：让这个工作区
 * 改看当前账本（停在同一页），或者返回。
 *
 * 不在工作区里（手机、组件测试）或查看的就是当前账本时，原样渲染页面。
 */
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { currentBookIdHeader } from "../lib/api.js";
import { useBooks, useLedger } from "../lib/queries.js";
import { useForeignBookId } from "../lib/workspaceLedger.js";
import { usePane, useWorkspaceActions } from "./context.js";

export function CurrentLedgerOnly({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const foreign = useForeignBookId();
  if (foreign === null) return <>{children}</>;
  return <ForeignNotice />;
}

function ForeignNotice(): React.JSX.Element {
  const { t } = useI18n();
  const ledger = useLedger();
  const books = useBooks();
  const actions = useWorkspaceActions();
  const { instance } = usePane();
  const deviceId = currentBookIdHeader();
  const current = books.data?.books.find((book) => book.id === deviceId)?.name ?? "";
  return (
    <InnerPage title={t("workspace.ledger.onlyCurrentTitle")}>
      <p className="text-body-relaxed text-muted">
        {t("workspace.ledger.onlyCurrentBody", { name: ledger.data?.book.name ?? "", current })}
      </p>
      {actions === null ? null : (
        <button
          type="button"
          onClick={() => {
            actions.viewDeviceLedger(instance);
          }}
          className="inline-flex self-start rounded-field bg-brand px-4 py-2.5 text-sm font-medium text-on-brand transition hover:bg-brand-dark"
        >
          {t("workspace.ledger.useCurrent")}
        </button>
      )}
    </InnerPage>
  );
}
