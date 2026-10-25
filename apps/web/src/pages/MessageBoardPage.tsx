import type { QuoteReferenceKind } from "@libellum/shared";
import { useSearchParams } from "react-router";

import { MessageBoardFull } from "../components/MessageBoard.js";
import { SkeletonRows } from "../components/States.js";
import { useI18n } from "../i18n/index.js";
import { useLedger } from "../lib/queries.js";

/**
 * ⚠️ **The shortcut entry's quote, parsed from the URL and dropped if it does not parse.** The URL is
 * the only thing that crosses a navigation, so this is the one place the request is decoded — and a
 * malformed link must degrade to an ordinary composer rather than fail the screen.
 */
function readQuoteRequest(params: URLSearchParams): { kind: QuoteReferenceKind; id: string } | undefined {
  const raw = params.get("quote");
  if (raw === null) return undefined;
  const [kind, id] = raw.split(":");
  if ((kind !== "transaction" && kind !== "event") || id === undefined || id === "") return undefined;
  return { kind, id };
}

/**
 * **完整留言对话 —— 全屏，不是弹窗也不是半屏抽屉。**
 *
 * ⚠️ **The owner chose full screen explicitly**:
 *
 * > *"点击「展开」后，进入独立的全屏留言界面，而不是弹窗或半屏抽屉。"*
 *
 * ⚠️ **And it is a route rather than local state, which is what makes the phone's back gesture and
 * the browser's back button both close it** — a sheet would have to reimplement those, and would get
 * one of them wrong on somebody's device.
 *
 * ⚠️ **It reads the same `useBookMessages` the card does, and sends through the same
 * `useMessageComposer`** — *"两种界面应共享同一套发送、读取和权限逻辑"* and *"不应因为切换小窗口和
 * 完整界面而丢失已经成功发送的消息."* There is no second store here; the draft lives in the message
 * module precisely so that moving between the two views cannot lose it.
 *
 * ⚠️ **Returning goes back to `/ledger`, and does not change which ledger this is.** Nothing on this
 * page can: the ledger comes from the request header and from `currentBook`, both set elsewhere — so
 * *"返回时恢复原来的协作页面，不意外切换账本"* is a property of not touching them.
 */
export function MessageBoardPage(): React.JSX.Element {
  const ledger = useLedger();
  const [searchParams] = useSearchParams();
  const quoteRequest = readQuoteRequest(searchParams);
  const { t } = useI18n();

  /**
   * ⚠️ **The name waits for the ledger rather than showing a placeholder heading**, because the
   * header says which ledger's board this is — and a wrong or empty name there is exactly the "which
   * ledger am I in" confusion the whole isolation design exists to prevent.
   */
  if (ledger.isPending) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-8">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (ledger.isError) {
    /**
     * ⚠️ **Said plainly, with a way back.** Sending the reader to a board that cannot name its ledger
     * would risk them writing a sentence into the wrong one.
     */
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-8">
        <p className="rounded-card border border-line bg-surface px-5 py-4 text-body-relaxed text-muted">
          {t("collab.messages.ledgerLoadFailed")}
        </p>
        <a href="/ledger" className="text-body text-brand transition hover:text-brand-dark">
          {t("collab.messages.backToLedger")}
        </a>
      </div>
    );
  }

  return <MessageBoardFull bookName={ledger.data.book.name} {...(quoteRequest === undefined ? {} : { quoteRequest })} />;
}
