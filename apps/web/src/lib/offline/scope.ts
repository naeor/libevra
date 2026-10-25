import { readValue, writeValue } from "./storage.js";
import { withDeadline } from "./deadline.js";

const SCOPE_KEY = "offline-scope";
let account = "";
let ledger = "";
let scope = "";
const isolated = new Set<string>();

function recompute(): void {
  scope = account && ledger ? `${account}:${ledger}` : "";
  void writeValue(SCOPE_KEY, { account, ledger });
}

/** 账号变化不能继承上一账号的账本；权限仍由服务器判断。 */
export function setOfflineAccount(userId: string | null): void {
  if (account !== (userId ?? "")) ledger = "";
  account = userId ?? "";
  recompute();
}

export function setOfflineBook(bookId: string | null): void {
  ledger = bookId ?? "";
  recompute();
}

export function setOfflineScope(userId: string | null, bookId: string | null): void {
  account = userId ?? "";
  ledger = bookId ?? "";
  recompute();
}

export function clearOfflineScope(): void {
  setOfflineScope(null, null);
}

export function offlineScope(): string {
  return scope;
}

/** 未知身份绝不读取旧全局键；隔离后的原件仍留在原地址。 */
export function scopedKey(base: string): string {
  return `${base}:${scope || "unresolved"}${isolated.has(scope) ? ":isolated-v1" : ""}`;
}

/** 冷启动先有界读盘，再挂载 React；超时的迟到读取没有修改运行状态的回调。 */
export async function restoreOfflineScope(selectedBook?: string | null): Promise<void> {
  const result = await withDeadline(Promise.all([
    readValue<{ account?: string }>(SCOPE_KEY),
    readValue<{ id?: string }>("auth-user"),
    selectedBook === undefined ? readValue<string>("current-book") : Promise.resolve(selectedBook),
  ]));
  if (result.value === null) return;
  const [stored, user, book] = result.value;
  account = typeof user?.id === "string" ? user.id : "";
  ledger = account !== "" && stored?.account === account && typeof book === "string" ? book : "";
  scope = account && ledger ? `${account}:${ledger}` : "";
  if (!(await isolateMismatchedCopy())) {
    ledger = "";
    scope = "";
  }
}

function cachedBook(value: string | null): string | null {
  try {
    const parsed = JSON.parse(value ?? "null") as { clientState?: { queries?: {
      queryKey?: unknown[]; state?: { data?: { book?: { id?: string } } };
    }[] } } | null;
    return parsed?.clientState?.queries?.find(q => q.queryKey?.[0] === "ledger")?.state?.data?.book?.id ?? null;
  } catch { return null; }
}

/** 仅隔离有错误归属证据的副本；不猜测、不删除，也不投递其中未同步原件。 */
export async function isolateMismatchedCopy(captured = scope, book = ledger): Promise<boolean> {
  if (!captured) return true;
  const marker = `offline-isolation:${captured}`;
  const saved = await withDeadline(readValue<boolean>(marker));
  if (saved.timedOut) return false;
  if (saved.value) {
    isolated.add(captured);
    return true;
  }
  const result = await withDeadline(Promise.all([
    readValue<string>(`query-cache:${captured}`), readValue<string>("query-cache"),
    readValue<unknown>(`ledger-months:${captured}`), readValue<unknown>("ledger-months"),
    readValue<unknown>(`ledger-marks:${captured}`), readValue<unknown>("ledger-marks"),
  ]));
  if (result.value === null) return false;
  const [raw, legacy, months, legacyMonths, marks, legacyMarks] = result.value;
  const owner = cachedBook(raw);
  const legacyOwner = cachedBook(legacy);
  const copied = (value: unknown, source: unknown) => value !== null && source !== null
    && JSON.stringify(value) !== "{}" && JSON.stringify(value) === JSON.stringify(source);
  if ((owner !== null && owner !== book) || (legacyOwner !== null && legacyOwner !== book
    && (copied(months, legacyMonths) || copied(marks, legacyMarks)))) {
    isolated.add(captured);
    await withDeadline(writeValue(marker, true));
  }
  return true;
}

/** 先验证归属，再开放作用域给后台同步；不从旧全局键自动认领任何数据。 */
export async function prepareOfflineBook(bookId: string): Promise<void> {
  const owner = account;
  if (!(await isolateMismatchedCopy(owner && bookId ? `${owner}:${bookId}` : "", bookId))) return;
  if (account === owner) setOfflineBook(bookId);
}
