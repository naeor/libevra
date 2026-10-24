import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { t as translate, useI18n } from "../i18n/index.js";
import { clearAllMarks, readStoredMonths } from "../lib/offline/localLedger.js";
import { deferConflictsToServer } from "../lib/offline/sync.js";

/**
 * The confirmation before the app reloads itself.
 *
 * ⚠️ **Exported so the wording can be checked by a test.** This is a dialog a person only ever sees
 * once they have already decided to press the button, so the sentences have to carry the whole cost
 * of the decision — and a sentence is the one thing a rendered test cannot click its way to.
 *
 * ⚠️ **It must not claim more than it does.** `window.location.reload()` re-opens the page: it does
 * not clear the local copy, does not fix a database, and does not send a request. The "clear and
 * reload" on 下载管理 is a *different* operation that deletes the device's copy first, and the two
 * must not be described alike.
 *
 * ⚠️ **S16：是函数，不是常量。** 文案在 `books.more.reload.*`，必须在打开对话框时按当前语言取；
 * 模块顶层的常量会把导入那一刻的语言固定下来。
 */
export function reloadConfirmation(): {
  readonly title: string;
  readonly description: string;
  readonly consequences: readonly string[];
  readonly confirmLabel: string;
} {
  return {
    title: translate("books.more.reload.title"),
    description: translate("books.more.reload.description"),
    consequences: [
      translate("books.more.reload.formLost"),
      translate("books.more.reload.importInterrupted"),
      translate("books.more.reload.nothingDeleted"),
    ],
    confirmLabel: translate("books.more.reload.confirm"),
  };
}

/**
 * The ledger's own "more" screen.
 *
 * ⚠️ **The owner asked for this, and it fixes something that had been in the wrong place**: "把清空带同步印记从
 * 下载管理-更多挪出来吧。明细页面不是还有一个'更多'键没用吗？让那个键点开之后，打开明细-更多页面."
 *
 * **He is right about both halves.** The button lived under 下载管理 — but **clearing a "not yet synced" mark is a
 * statement about entries, not about downloads**, and nobody looking for it would think to look there. And the
 * ledger's 更多 button had been disabled since it was drawn, saying "更多操作即将开放" — **an entry point that
 * exists and does nothing is worse than one that is not there**, which is the owner's own rule.
 *
 * ⚠️ **S15-C: 导出 moved here from the ledger's top row**, which is now 刷新 / 批量操作 / 更多. The export
 * screen itself is untouched — this is an entry point, not a rewrite.
 */
export function LedgerMorePage(): React.JSX.Element {
  const { t } = useI18n();
  const reload = reloadConfirmation();
  const navigate = useNavigate();
  const [cleared, setCleared] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [counts, setCounts] = useState<{ readonly months: number; readonly entries: number } | null>(null);

  /**
   * ⚠️ **In an effect, not in the render body.** The first version called this during render, which would have
   * started a new read on **every** render — and the read itself sets state, so it would not have stopped. **A
   * side effect in a render body is not a slow screen, it is a loop.**
   */
  useEffect(() => {
    void (async () => {
      const months = await readStoredMonths();

      setCounts({
        months: Object.keys(months).length,
        entries: Object.values(months).reduce((total, list) => total + list.length, 0),
      });
    })();
  }, []);

  return (
    <InnerPage title={t("books.more.title")}>
      {/**
        * ⚠️ **S16-A：四段"按钮 + 一段说明"改成三组列表行。** 原来每个入口都是一块整宽的大按钮，
        * 下面再跟一段灰字，页面读起来像一排同样重要的大按钮；而且外层多套了一层 `px-6`，
        * 内容比其它页面缩进了一倍。现在：
        *
        * - 去往别处的（导出、回到明细）是带 `›` 的行；
        * - 就地执行的（清空印记、重新加载）是强调色的行，没有箭头；
        * - 每段说明成为对应行的第二行。S16 文案复核后，清空印记明确说明停止提交与服务器冲突处理。
        */}
      <p className="text-body text-ink">
        <span className="text-muted">{t("books.more.device")}</span>
        {counts === null
          ? t("books.more.loading")
          : t("books.more.stored", {
              months: t("books.more.months", { count: counts.months }),
              entries: t("books.more.entries", { count: counts.entries }),
            })}
      </p>

      <ListGroup title={t("books.more.exportGroup")}>
        <ListRow
          label={t("books.more.exportRow.label")}
          detail={t("books.more.exportRow.detail")}
          onClick={() => {
            void navigate("/export");
          }}
        />
      </ListGroup>

      <ListGroup title={t("books.more.filterGroup")}>
        <ListRow
          label={t("books.more.filterRow.label")}
          detail={t("books.more.filterRow.detail")}
          onClick={() => {
            void navigate("/");
          }}
        />
      </ListGroup>

      <ListGroup title={t("books.more.maintenanceGroup")}>
        <ListRow
          tone="action"
          label={cleared ? t("books.more.cleared") : t("books.more.clearMarks")}
          detail={t("books.more.clearDetail")}
          onClick={() => {
            void (async () => {
              await deferConflictsToServer();
              await clearAllMarks();
              setCleared(true);
            })();
          }}
        />
        <ListRow
          tone="action"
          label={t("books.more.reloadRow.label")}
          detail={t("books.more.reloadRow.detail")}
          onClick={() => {
            setConfirmReload(true);
          }}
        />
      </ListGroup>

      <ConfirmDialog
        open={confirmReload}
        title={reload.title}
        description={reload.description}
        consequences={reload.consequences}
        confirmLabel={reload.confirmLabel}
        onCancel={() => {
          setConfirmReload(false);
        }}
        onConfirm={() => {
          /**
           * ⚠️ **A plain reload, and nothing else.** No `caches.delete`, no IndexedDB clearing, no
           * queue flushing: those would make this button a different, destructive operation wearing
           * the same words as 下载管理's 清除并重新加载.
           */
          window.location.reload();
        }}
      />
    </InnerPage>
  );
}
