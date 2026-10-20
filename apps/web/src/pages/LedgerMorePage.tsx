import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
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
 */
export const RELOAD_CONFIRMATION = {
  title: "重新加载应用？",
  description: "页面会像重新打开一样再加载一次，用来恢复界面异常。",
  consequences: [
    "未保存的表单内容会丢失",
    "正在进行的导入可能中断",
    "不会清除本机账目，也不会删除服务器上的任何数据",
  ],
  confirmLabel: "重新加载",
} as const;

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
    <InnerPage title="明细 · 更多">
      <div className="flex flex-col gap-6 px-6 py-5">
        <section className="flex flex-col gap-1">
          <h2 className="text-helper text-muted">这台设备</h2>
          <p className="text-body text-ink">
            {counts === null
              ? "正在读取…"
              : `本机存着 ${String(counts.months)} 个月、${String(counts.entries)} 条账目。`}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-helper text-muted">导出账目</h2>
          <Button
            variant="secondary"
            onClick={() => {
              void navigate("/export");
            }}
          >
            导出为文件
          </Button>
          <p className="text-helper-relaxed text-muted">
            打开导出页面，按月份和条件导出 CSV 或 JSON。导出的范围与字段都在那个页面上选择。
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-helper text-muted">筛选与查找</h2>
          <Button
            variant="secondary"
            onClick={() => {
              void navigate("/");
            }}
          >
            回到明细页筛选
          </Button>
          <p className="text-helper-relaxed text-muted">
            明细页顶部可以按月、按收支切换；点某笔账目的分类，就只看这个分类。
            <span className="text-ink"> 目前还没有按文字搜索账目</span>
            ——它需要一个真正的搜索功能，不是在这里加一个入口就能做好的，所以这次没有做。
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-helper text-muted">数据维护</h2>

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                void (async () => {
                  /**
                   * ⚠️ **The server is told as well, and that is the half that makes this work.**
                   *
                   * "清空印记就意味着不选了使用服务器当前的值" — **which is a decision the server has to hear**, or it
                   * keeps raising the same questions and the next pull hands them back.
                   */
                  await deferConflictsToServer();
                  await clearAllMarks();
                  setCleared(true);
                })();
              }}
            >
              {cleared ? "已清空待同步印记" : "清空「待同步」印记"}
            </Button>

            <p className="text-helper-relaxed text-muted">
              停止把这些账目当作「还没同步」「还没删除」或「等你要选」来提醒。
              不会发送任何请求，也不会删掉服务器或本机上的任何账目 —— 只是让它们不再带颜色。
              服务器上确实已经删掉的，本机下次取回列表时会照常消失。
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmReload(true);
              }}
            >
              重新加载应用
            </Button>

            <p className="text-helper-relaxed text-muted">
              界面出现异常时，重新加载页面通常能恢复。
              它只是重新打开这个页面，<span className="text-ink">不会清除本机账目</span>
              ；也不会修复服务器上的数据 —— 那是另一件事。
            </p>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReload}
        title={RELOAD_CONFIRMATION.title}
        description={RELOAD_CONFIRMATION.description}
        consequences={RELOAD_CONFIRMATION.consequences}
        confirmLabel={RELOAD_CONFIRMATION.confirmLabel}
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
