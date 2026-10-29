import { isChineseLocale, t } from "../../i18n/index.js";

/**
 * 两句话接在一起：中文句号本身就是分隔，英文等语言之间要一个空格。第二句为空时只返回第一句。
 */
function withNote(main: string, note: string): string {
  if (note === "") return main;
  return isChineseLocale() ? `${main}${note}` : `${main} ${note}`;
}

/**
 * What the refresh button says afterwards.
 *
 * ⚠️ **The button used to say nothing, and "did that work?" is not a question a person should have to
 * answer by guessing.** It is also the one place where a wrong sentence is worse than no sentence: a
 * refresh that could not reach the server must not read like one that did.
 *
 * ⚠️ **`syncMonth` cannot report its own failure** — a failed request comes back as "0 entries", which
 * is indistinguishable from a month that really has none. So this function never claims the cloud was
 * reached on a zero: it says what happened locally, and says the cloud may not be in the picture.
 *
 * Kept as a pure function so the wording itself can be tested: the tests this project writes run
 * without a DOM, and the failure cases are exactly the ones worth pinning down.
 */
export function refreshMessage(input: {
  readonly guest: boolean;
  /** The merged offline signal as it was when the button was pressed. */
  readonly offline: boolean;
  /** Entries the device delivered to the server. */
  readonly delivered: number;
  /** Entries the month download brought back. */
  readonly pulled: number;
  /** True when the attempt threw before finishing. */
  readonly failed: boolean;
  readonly error: string | null;
  /**
   * ⚠️ **How many changes are still waiting after the attempt.**
   *
   * Without this the last sentence below could say "没有待投递的改动" while the list is showing rows the
   * server has not accepted — **the delivery can fail without throwing** (a refused request is counted,
   * not raised), so `delivered === 0` does not mean "there was nothing to send". The owner's report was
   * exactly that pair of facts on one screen: red rows, and a refresh that reported nothing to do.
   */
  readonly waiting: number;
  /** 明细页选的是「全部」（1.17.17）：拉取的是全部记录而不是当前月，句子不能说「当前月」。 */
  readonly allMonths?: boolean;
}): string {
  /**
   * ⚠️ **Said in every branch where it is true**, rather than only in the empty one: changes left behind
   * are the thing the reader needs to know, and "投递了 3 条" with four rows still waiting is just as
   * misleading as "没有待投递的改动".
   */
  const waitingNote = input.waiting > 0 ? t("ledger.refresh.waiting", { count: input.waiting }) : "";

  if (input.failed) {
    const reason = input.error === null || input.error === "" ? t("ledger.refresh.unknownReason") : input.error;

    return t("ledger.refresh.failed", { reason });
  }

  if (input.guest) return t("ledger.refresh.guest");

  if (input.offline && input.delivered === 0 && input.pulled === 0) {
    return withNote(t("ledger.refresh.offline"), waitingNote);
  }

  const all = input.allMonths === true;

  if (input.delivered > 0 && input.pulled > 0) {
    return withNote(
      all
        ? t("ledger.refresh.deliveredAndPulledAll", { count: input.delivered, pulled: input.pulled })
        : t("ledger.refresh.deliveredAndPulled", { count: input.delivered, pulled: input.pulled }),
      waitingNote,
    );
  }

  if (input.delivered > 0) {
    return withNote(
      all
        ? t("ledger.refresh.deliveredAll", { count: input.delivered })
        : t("ledger.refresh.delivered", { count: input.delivered }),
      waitingNote,
    );
  }

  if (input.pulled > 0) {
    return withNote(
      all ? t("ledger.refresh.pulledAll", { pulled: input.pulled }) : t("ledger.refresh.pulled", { pulled: input.pulled }),
      waitingNote,
    );
  }

  if (waitingNote !== "") return t("ledger.refresh.reloadedWaiting", { note: waitingNote });

  return t("ledger.refresh.nothing");
}
