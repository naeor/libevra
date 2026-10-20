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
}): string {
  if (input.failed) {
    const reason = input.error === null || input.error === "" ? "原因不明" : input.error;

    return `同步没有完成：${reason}。已经重新读取了本机账目。`;
  }

  if (input.guest) return "已重新读取本机账目（游客账本没有云端可同步）。";

  if (input.offline && input.delivered === 0 && input.pulled === 0) {
    return "当前离线，没能连上云端；已经重新读取了本机账目。";
  }

  if (input.delivered > 0 && input.pulled > 0) {
    return `已向云端投递 ${String(input.delivered)} 条，并更新了当前月（${String(input.pulled)} 条来自云端）。`;
  }

  if (input.delivered > 0) {
    return `已向云端投递 ${String(input.delivered)} 条；当前月没有从云端取回新的数据。`;
  }

  if (input.pulled > 0) {
    return `已更新当前月（${String(input.pulled)} 条来自云端）。`;
  }

  return "已重新读取本机账目；没有待投递的改动，也没有从云端取回新的数据。";
}
