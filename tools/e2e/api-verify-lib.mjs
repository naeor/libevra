/**
 * S13-E 后端 / API 验收的公共库（隔离 E2E 环境专用）。
 *
 * 约束（见任务说明）：
 * - 只访问 E2E API（默认 http://127.0.0.1:3100/api/v1），绝不访问 3000 / 5173；
 * - 不连接任何远程/生产库，不运行项目自带 api 测试；
 * - 不删除、不修改基线 A/B 账本与 baseline 数据；自己创建的对象自己清理；
 * - 账号密码只从 %TEMP%\libevra-e2e\state.json 读取，绝不打印、绝不写进报告。
 *
 * 这里只放“环境 + 会话 + 断言 + 领域助手 + 夹具 + 清理”，用例主体在
 * api-verification.mjs。
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const DIR = process.env.E2E_STATE_DIR ?? join(tmpdir(), "libevra-e2e");
export const state = JSON.parse(readFileSync(join(DIR, "state.json"), "utf8").replace(/^\uFEFF/, ""));
export const BASE = process.env.E2E_API_BASE ?? state.apiBase ?? "http://127.0.0.1:3100/api/v1";
export const WEB_BASE = process.env.E2E_WEB_BASE ?? "http://127.0.0.1:5175";

/** Short run tag, used in the names of every object this script creates. */
export const RUN = Math.random().toString(36).slice(2, 5).toUpperCase();
export const PREFIX = `T${RUN}-`;

export const USER = {
  a: {
    key: "a",
    label: "Test-A",
    username: state.users.a.username,
    displayName: state.users.a.displayName,
    password: state.users.a.password,
    id: state.users.a.id,
    book: state.books.a.id,
  },
  b: {
    key: "b",
    label: "Test-B",
    username: state.users.b.username,
    displayName: state.users.b.displayName,
    password: state.users.b.password,
    id: state.users.b.id,
    book: state.books.b.id,
  },
};

export const BOOK = { a: state.books.a.id, b: state.books.b.id };
export const BASELINE_TX = { a: [...state.transactions.a], b: [...state.transactions.b] };
export const BOOK_LABEL = new Map([
  [BOOK.a, "A"],
  [BOOK.b, "B"],
]);

export const cookies = { a: null, b: null };

// ---------------------------------------------------------------------------
// Test context / evidence recording
// ---------------------------------------------------------------------------

const context = {
  current: null,
};

export function beginTest(id) {
  context.current = { id, requests: [], notes: [] };
  return context.current;
}

export function endTest() {
  const finished = context.current;
  context.current = null;
  return finished;
}

export function note(text) {
  if (context.current) context.current.notes.push(String(text));
}

export function observe(label, value) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  note(`观察 ${label}: ${rendered}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTTP client (Node 24 fetch + a deliberately simple cookie jar)
// ---------------------------------------------------------------------------

function bodySummary(data) {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data.slice(0, 180).replace(/\s+/g, " ");
  const text = JSON.stringify(data);
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

export function messageOf(result) {
  if (!result) return "(no response)";
  const code = result.data?.code;
  const message = result.data?.message;
  return [code, message].filter(Boolean).join(": ") || bodySummary(result.data);
}

/**
 * One authenticated (or anonymous) API call.
 *
 * @param {"a"|"b"|null} userKey
 * @param {string} method
 * @param {string} path              e.g. "/ledger" (BASE is prefixed)
 */
export async function call(userKey, method, path, options = {}) {
  const { body, form, book, headers = {}, retryOn429 = true } = options;
  const requestHeaders = { ...headers };

  if (book) requestHeaders["x-libellum-book"] = book;
  if (userKey && cookies[userKey]) requestHeaders.cookie = cookies[userKey];

  let payload;
  if (form !== undefined) {
    payload = form;
  } else if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const send = async () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: requestHeaders,
      body: payload,
    });

  let response;
  try {
    response = await send();
  } catch (error) {
    if (context.current) {
      context.current.requests.push({ method, path, book: requestHeaders["x-libellum-book"] ?? null, status: 0, body: String(error) });
    }
    return { status: 0, data: { code: "network_error", message: String(error) }, setCookie: null, headers: new Headers(), text: "" };
  }

  if (response.status === 429 && retryOn429) {
    if (context.current) {
      context.current.requests.push({ method, path, book: requestHeaders["x-libellum-book"] ?? null, status: 429, body: "rate limited — waiting 2s and retrying once" });
    }
    await sleep(2000);
    try {
      response = await send();
    } catch (error) {
      return { status: 0, data: { code: "network_error", message: String(error) }, setCookie: null, headers: new Headers(), text: "" };
    }
  }

  const text = await response.text();
  let data;
  try {
    data = text === "" ? null : JSON.parse(text);
  } catch {
    data = text;
  }

  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const sessionCookie = setCookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("libellum_session="));

  if (userKey && sessionCookie) cookies[userKey] = sessionCookie;

  if (context.current) {
    context.current.requests.push({
      method,
      path,
      book: requestHeaders["x-libellum-book"] ?? null,
      status: response.status,
      body: bodySummary(data),
    });
  }

  return { status: response.status, data, setCookie: sessionCookie ?? null, headers: response.headers, text };
}

/**
 * A GET whose bytes are inspected instead of its text.
 *
 * ⚠️ `Response.text()` decodes as UTF-8 with a BOM-stripping decoder, so the
 * byte-order mark an export writes deliberately is invisible through it. The
 * export check needs the raw bytes.
 */
export async function rawGet(userKey, path, options = {}) {
  const headers = {};
  if (userKey && cookies[userKey]) headers.cookie = cookies[userKey];
  if (options.book) headers["x-libellum-book"] = options.book;

  const response = await fetch(`${BASE}${path}`, { method: "GET", headers });
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (context.current) {
    context.current.requests.push({
      method: "GET",
      path,
      book: headers["x-libellum-book"] ?? null,
      status: response.status,
      body: `${bytes.length} bytes, first=${[...bytes.slice(0, 3)].map((value) => value.toString(16)).join(" ")}`,
    });
  }

  return { status: response.status, headers: response.headers, bytes };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export class CheckFailure extends Error {}

export function check(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

export function eq(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new CheckFailure(`${label}: 期望 ${right}，实际 ${left}`);
  }
}

export function eqNumber(actual, expected, label) {
  if (actual !== expected) throw new CheckFailure(`${label}: 期望 ${expected}，实际 ${actual}`);
}

export function expectStatus(result, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(result.status)) {
    throw new CheckFailure(`${label}: 期望 HTTP ${allowed.join("/")}，实际 ${result.status}（${messageOf(result)}）`);
  }
  return result.data;
}

export function expectError(result, status, code, label) {
  expectStatus(result, status, label);
  if (result.data?.code !== code) {
    throw new CheckFailure(`${label}: 期望错误码 ${code}，实际 ${result.data?.code}（${messageOf(result)}）`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Snapshots used to prove "only the foreign key changed"
// ---------------------------------------------------------------------------

export function snapshotTransaction(dto) {
  return {
    id: dto.id,
    seq: dto.seq,
    kind: dto.kind,
    amountCents: dto.amountCents,
    currency: dto.currency,
    occurredAt: dto.occurredAt,
    occurredLocalDate: dto.occurredLocalDate,
    occurredTz: dto.occurredTz,
    note: dto.note,
    version: dto.version,
    tags: (dto.tags ?? []).map((tag) => tag.id).sort(),
  };
}

export function fullTransactionSnapshot(dto) {
  return {
    ...snapshotTransaction(dto),
    categoryId: dto.categoryId,
    categoryName: dto.categoryName,
    categoryIsSystem: dto.categoryIsSystem,
    paymentMethodId: dto.paymentMethodId,
    paymentMethodName: dto.paymentMethodName,
  };
}

export function summaryMap(summary) {
  const map = {};
  for (const row of summary?.currencies ?? []) map[row.currency] = row;
  return map;
}

export function statsFingerprint(stats) {
  return {
    totals: stats?.totals,
    byCategory: (stats?.byCategory ?? [])
      .map((row) => ({ categoryId: row.categoryId, kind: row.kind, minor: row.minor }))
      .sort((left, right) => `${left.categoryId}`.localeCompare(`${right.categoryId}`)),
  };
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export async function loginAll() {
  for (const key of ["a", "b"]) {
    const result = await call(key, "POST", "/auth/login", {
      body: { username: USER[key].username, password: USER[key].password },
    });
    if (result.status !== 200 || !cookies[key]) {
      throw new Error(`登录 ${USER[key].label} 失败：HTTP ${result.status} ${messageOf(result)}`);
    }
  }
  return { a: USER.a.id, b: USER.b.id };
}

export async function health() {
  return call(null, "GET", "/health");
}

export const booksOf = async (user) => expectStatus(await call(user, "GET", "/books"), 200, `${USER[user].label} GET /books`);
export const ledgerOf = async (user, book) => expectStatus(await call(user, "GET", "/ledger", { book }), 200, `${USER[user].label} GET /ledger [${BOOK_LABEL.get(book) ?? "?"}]`);
export const membersOf = async (user, book) => expectStatus(await call(user, "GET", "/books/members", { book }), 200, `${USER[user].label} GET /books/members [${BOOK_LABEL.get(book) ?? "?"}]`);
export const usageOf = async (user, book) => expectStatus(await call(user, "GET", "/ledger/classification-usage", { book }), 200, `${USER[user].label} GET classification-usage [${BOOK_LABEL.get(book) ?? "?"}]`);
export const operationsOf = async (user, book, limit) => expectStatus(await call(user, "GET", `/ledger/operations${limit === undefined ? "" : `?limit=${limit}`}`, { book }), 200, `${USER[user].label} GET /ledger/operations [${BOOK_LABEL.get(book) ?? "?"}]`);
export const historyOf = async (user, book, limit = 200) => expectStatus(await call(user, "GET", `/ledger/history?limit=${limit}`, { book }), 200, `${USER[user].label} GET /ledger/history [${BOOK_LABEL.get(book) ?? "?"}]`);
export const summaryOf = async (user, book, month) => expectStatus(await call(user, "GET", `/summary${month ? `?month=${month}` : ""}`, { book }), 200, `${USER[user].label} GET /summary [${BOOK_LABEL.get(book) ?? "?"}]`);
export const statsOf = async (user, book, from, to, currency = "CNY") =>
  expectStatus(await call(user, "GET", `/stats?from=${from}&to=${to}&currency=${currency}`, { book }), 200, `${USER[user].label} GET /stats [${BOOK_LABEL.get(book) ?? "?"}]`);

export async function transactionsOf(user, book, query = "") {
  const data = expectStatus(await call(user, "GET", `/transactions${query}`, { book }), 200, `${USER[user].label} GET /transactions${query} [${BOOK_LABEL.get(book) ?? "?"}]`);
  return data;
}

export async function transactionOf(user, book, id) {
  const result = await call(user, "GET", `/transactions/${id}`, { book });
  return result;
}

export async function createCategory(user, book, name, kind) {
  const result = await call(user, "POST", "/categories", { body: { name, kind }, book });
  expectStatus(result, 201, `创建分类 ${name}`);
  created.categories.push({ user, book, id: result.data.id, name });
  return result.data;
}

export async function createPayment(user, book, name) {
  const result = await call(user, "POST", "/payment-methods", { body: { name }, book });
  expectStatus(result, 201, `创建支付方式 ${name}`);
  created.payments.push({ user, book, id: result.data.id, name });
  return result.data;
}

export async function createTag(user, book, name, color = "#446688") {
  const result = await call(user, "POST", "/tags", { body: { name, color }, book });
  expectStatus(result, 201, `创建标签 ${name}`);
  created.tags.push({ user, book, id: result.data.id, name });
  return result.data;
}

/**
 * Create an entry in the isolated environment.
 *
 * The returned DTO is also snapshotted, so a later test can prove that a
 * category/payment/tag re-link changed **nothing but the foreign key**.
 */
export async function createTransaction(user, book, fields = {}) {
  const id = fields.id ?? randomUUID();
  const occurredAt = fields.occurredAt ?? new Date().toISOString();
  const body = {
    id,
    idempotencyKey: fields.idempotencyKey ?? id,
    kind: fields.kind ?? "expense",
    amountCents: fields.amountCents ?? 100,
    currency: fields.currency ?? "CNY",
    occurredAt,
    occurredLocalDate: fields.occurredLocalDate ?? occurredAt.slice(0, 10),
    occurredTz: fields.occurredTz ?? "Asia/Shanghai",
    note: fields.note ?? `${PREFIX}${fields.key ?? "tx"}`,
    tagIds: fields.tagIds ?? [],
  };
  if (fields.categoryId !== undefined) body.categoryId = fields.categoryId;
  if (fields.paymentMethodId !== undefined) body.paymentMethodId = fields.paymentMethodId;

  const result = await call(user, "POST", "/transactions", { body, book });
  expectStatus(result, 201, `创建账目 ${body.note}`);
  created.transactions.push({ user, book, id: result.data.id, creator: user });
  return result.data;
}

export async function deleteTransaction(user, book, id) {
  return call(user, "DELETE", `/transactions/${id}`, { book });
}

export async function restoreTransaction(user, book, id) {
  return call(user, "POST", `/transactions/${id}/restore`, { book });
}

/** PATCH through the conflict-protocol `changes` chain, which is what the app sends. */
export async function patchTransaction(user, book, id, patches) {
  const current = expectStatus(await call(user, "GET", `/transactions/${id}`, { book }), 200, "读取待修改账目");
  const changes = Object.entries(patches).map(([field, wanted]) => {
    const base = field === "tagIds" ? current.tags.map((tag) => tag.id) : current[field];
    return { field, base, wanted, chain: [base, wanted] };
  });
  return call(user, "PATCH", `/transactions/${id}`, { body: { version: current.version, changes }, book });
}

export function permanentDeleteCategory(user, book, id, body) {
  return call(user, "POST", `/categories/${id}/permanent-delete`, body === undefined ? { book } : { body, book });
}

export function permanentDeletePayment(user, book, id, body) {
  return call(user, "POST", `/payment-methods/${id}/permanent-delete`, body === undefined ? { book } : { body, book });
}

export function deleteTag(user, book, id) {
  return call(user, "DELETE", `/tags/${id}`, { book });
}

export function archiveCategory(user, book, id) {
  return call(user, "DELETE", `/categories/${id}`, { book });
}

export function archivePayment(user, book, id) {
  return call(user, "DELETE", `/payment-methods/${id}`, { book });
}

export function patchPayment(user, book, id, body) {
  return call(user, "PATCH", `/payment-methods/${id}`, { body, book });
}

export function patchCategory(user, book, id, body) {
  return call(user, "PATCH", `/categories/${id}`, { body, book });
}

export function patchTag(user, book, id, body) {
  return call(user, "PATCH", `/tags/${id}`, { body, book });
}

export function setRole(actor, book, targetUserId, role) {
  return call(actor, "PATCH", `/books/members/${targetUserId}`, { body: { role }, book });
}

export function removeMemberRequest(actor, book, targetUserId) {
  return call(actor, "DELETE", `/books/members/${targetUserId}`, { book });
}

export function invite(actor, book, body) {
  return call(actor, "POST", "/books/invite", { body, book });
}

export const inboxOf = async (user) => expectStatus(await call(user, "GET", "/notifications"), 200, `${USER[user].label} GET /notifications`);
export function decide(user, notificationId, decision) {
  return call(user, "POST", `/notifications/${notificationId}/decide`, { body: { decision } });
}

export function renameBook(user, book, pathBookId, name) {
  return call(user, "PATCH", `/books/${pathBookId}`, { body: { name }, book });
}

export function disposeBook(user, bookId) {
  return call(user, "POST", `/books/${bookId}/dispose`);
}

export function restoreBook(user, bookId) {
  return call(user, "POST", `/books/${bookId}/restore`);
}

export function activateBook(user, bookId) {
  return call(user, "POST", `/books/${bookId}/activate`);
}

export function leaveBook(user, bookId) {
  return call(user, "POST", `/books/${bookId}/leave`);
}

export function createShareLink(user, book, body = {}) {
  return call(user, "POST", "/share/links", { body, book });
}

export function previewShareLink(user, token) {
  return call(user, "GET", `/share/${token}`);
}

export function joinShareLink(user, token) {
  return call(user, "POST", `/share/${token}/join`);
}

export function shareLinksOf(user, book) {
  return call(user, "GET", "/share/links", { book });
}

export function revokeShareLink(user, book, linkId) {
  return call(user, "POST", `/share/links/${linkId}/revoke`, { book });
}

export function exportGet(user, book, query = "?format=csv") {
  return call(user, "GET", `/export${query}`, { book });
}

export function exportPost(user, book, query = "?format=csv") {
  return call(user, "POST", `/export${query}`, { book });
}

export function exportLogOf(user, book) {
  return call(user, "GET", "/export-log", { book });
}

export function postMessage(user, book, text) {
  return call(user, "POST", "/books/messages", { body: { body: text }, book });
}

export async function importCsv(user, book, csvText, fileId = randomUUID()) {
  const form = new FormData();
  form.append("fileId", fileId);
  form.append("file", new Blob([csvText], { type: "text/csv" }), "e2e-import.csv");
  return call(user, "POST", "/import", { form, book });
}

export function adminGet(user, path) {
  return call(user, "GET", `/admin${path}`);
}

export function findCategory(ledger, id) {
  return (ledger.categories ?? []).find((category) => category.id === id);
}

export function findPayment(ledger, id) {
  return (ledger.paymentMethods ?? []).find((payment) => payment.id === id);
}

export function findTag(ledger, id) {
  return (ledger.tags ?? []).find((tag) => tag.id === id);
}

export function systemCategory(ledger, kind) {
  return (ledger.categories ?? []).find(
    (category) => category.isSystem && category.kind === kind && category.name === "暂无分类",
  );
}

export function bookSummary(books, id) {
  return (books.books ?? []).find((book) => book.id === id);
}

export function disposedSummary(books, id) {
  return (books.disposed ?? []).find((book) => book.id === id);
}

// ---------------------------------------------------------------------------
// Fixtures / tracked objects / baseline
// ---------------------------------------------------------------------------

export const fx = { a: {}, b: {}, sys: {} };
export const created = { transactions: [], categories: [], payments: [], tags: [], books: [] };
export const baseline = {};

const DATE = new Date();
export const CURRENT_MONTH = DATE.toISOString().slice(0, 7);

function rangeForCurrentMonth() {
  const [year, month] = CURRENT_MONTH.split("-").map(Number);
  const from = `${CURRENT_MONTH}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${CURRENT_MONTH}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export const STATS_RANGE = rangeForCurrentMonth();

export async function captureBaseline() {
  baseline.books = { a: await booksOf("a"), b: await booksOf("b") };
  baseline.members = { a: await membersOf("a", BOOK.a), b: await membersOf("b", BOOK.b) };
  baseline.ledger = { a: await ledgerOf("a", BOOK.a), b: await ledgerOf("b", BOOK.b) };
  baseline.summary = { a: await summaryOf("a", BOOK.a), b: await summaryOf("b", BOOK.b) };
  baseline.usage = { a: await usageOf("a", BOOK.a), b: await usageOf("b", BOOK.b) };
  baseline.operations = { a: await operationsOf("a", BOOK.a), b: await operationsOf("b", BOOK.b) };
  baseline.history = { a: await historyOf("a", BOOK.a, 1), b: await historyOf("b", BOOK.b, 1) };
  baseline.stats = { a: await statsOf("a", BOOK.a, STATS_RANGE.from, STATS_RANGE.to) };

  /**
   * Every entry that is live right now, not just the five from state.json.
   *
   * ⚠️ The E2E environment can have a couple of entries left over from a
   * previous browser check ("E2E UI delete target"). This run must not touch
   * them, but it must also not mistake their presence for one of its own
   * leftovers — so the cleanup checks are scoped by our run prefix, and the
   * baseline comparison is scoped by id.
   */
  baseline.startLive = { a: {}, b: {} };
  for (const key of ["a", "b"]) {
    const user = key === "a" ? "a" : "b";
    const book = key === "a" ? BOOK.a : BOOK.b;
    const list = await transactionsOf(user, book, "?limit=100");
    for (const item of list.items) baseline.startLive[key][item.id] = fullTransactionSnapshot(item);
  }

  baseline.transactions = { a: {}, b: {} };
  for (const id of BASELINE_TX.a) {
    const result = await call("a", "GET", `/transactions/${id}`, { book: BOOK.a });
    baseline.transactions.a[id] = result.status === 200 ? fullTransactionSnapshot(result.data) : { error: result.status };
  }
  for (const id of BASELINE_TX.b) {
    const result = await call("b", "GET", `/transactions/${id}`, { book: BOOK.b });
    baseline.transactions.b[id] = result.status === 200 ? fullTransactionSnapshot(result.data) : { error: result.status };
  }
}

/**
 * Create every object the delete/re-link tests need.
 *
 * Nothing here touches baseline rows: all names are prefixed with this run's tag,
 * all entries are in the current month but are soft-deleted by `cleanup()`.
 */
export async function setupFixtures() {
  const ledgerA = await ledgerOf("a", BOOK.a);
  const ledgerB = await ledgerOf("b", BOOK.b);
  fx.sys.aExpense = systemCategory(ledgerA, "expense");
  fx.sys.aIncome = systemCategory(ledgerA, "income");
  fx.sys.bExpense = systemCategory(ledgerB, "expense");
  if (!fx.sys.aExpense || !fx.sys.aIncome || !fx.sys.bExpense) {
    throw new Error("账本缺少系统分类「暂无分类」，环境不完整");
  }

  // Categories in book A -----------------------------------------------------
  fx.a.catAlpha = await createCategory("a", BOOK.a, `${PREFIX}CAT-A1`, "expense");
  fx.a.catBeta = await createCategory("a", BOOK.a, `${PREFIX}CAT-A2`, "expense");
  fx.a.catGammaIncome = await createCategory("a", BOOK.a, `${PREFIX}CAT-A3`, "income");
  fx.a.catUnused = await createCategory("a", BOOK.a, `${PREFIX}CAT-A4`, "expense");
  fx.a.catDefault = await createCategory("a", BOOK.a, `${PREFIX}CAT-A5`, "expense");
  fx.a.catNoBody = await createCategory("a", BOOK.a, `${PREFIX}CAT-A6`, "expense");
  fx.a.catSelf = await createCategory("a", BOOK.a, `${PREFIX}CAT-A7`, "expense");
  fx.a.catKind = await createCategory("a", BOOK.a, `${PREFIX}CAT-A8`, "expense");
  fx.a.catXLedger = await createCategory("a", BOOK.a, `${PREFIX}CAT-A9`, "expense");
  fx.a.catStat = await createCategory("a", BOOK.a, `${PREFIX}CAT-AA`, "expense");
  fx.a.catArch = await createCategory("a", BOOK.a, `${PREFIX}CAT-AB`, "expense");
  fx.a.catTombOnly = await createCategory("a", BOOK.a, `${PREFIX}CAT-AC`, "expense");

  // Payment methods in book A ----------------------------------------------
  fx.a.pay1 = await createPayment("a", BOOK.a, `${PREFIX}PAY-A1`);
  fx.a.pay2 = await createPayment("a", BOOK.a, `${PREFIX}PAY-A2`);
  fx.a.pay3 = await createPayment("a", BOOK.a, `${PREFIX}PAY-A3`);
  fx.a.payUnused = await createPayment("a", BOOK.a, `${PREFIX}PAY-A4`);
  fx.a.payArch = await createPayment("a", BOOK.a, `${PREFIX}PAY-A5`);
  fx.a.payConcR1 = await createPayment("a", BOOK.a, `${PREFIX}PAY-C1`);

  // Tags in book A ---------------------------------------------------------
  fx.a.tag1 = await createTag("a", BOOK.a, `${PREFIX}TAG-A1`);
  fx.a.tag2 = await createTag("a", BOOK.a, `${PREFIX}TAG-A2`);
  fx.a.tagUnused = await createTag("a", BOOK.a, `${PREFIX}TAG-A3`);
  fx.a.tagTomb = await createTag("a", BOOK.a, `${PREFIX}TAG-A4`);
  fx.a.tagEditor = await createTag("a", BOOK.a, `${PREFIX}TAG-A5`);
  fx.a.tagOwner = await createTag("a", BOOK.a, `${PREFIX}TAG-A6`);

  // Book B objects used for cross-ledger refusal ---------------------------
  fx.b.cat = await createCategory("b", BOOK.b, `${PREFIX}CAT-B1`, "expense");
  fx.b.pay = await createPayment("b", BOOK.b, `${PREFIX}PAY-B1`);
  fx.b.tag = await createTag("b", BOOK.b, `${PREFIX}TAG-B1`);

  // Transactions -----------------------------------------------------------
  fx.a.txAlpha1 = await createTransaction("a", BOOK.a, { key: "A1", categoryId: fx.a.catAlpha.id, amountCents: 1111, note: `${PREFIX}A1-CNY` });
  fx.a.txAlpha2 = await createTransaction("a", BOOK.a, { key: "A2", categoryId: fx.a.catAlpha.id, amountCents: 2222, currency: "USD", note: `${PREFIX}A2-USD` });
  fx.a.txAlpha3 = await createTransaction("a", BOOK.a, { key: "A3", categoryId: fx.a.catAlpha.id, amountCents: 3333, note: `${PREFIX}A3-CNY` });
  fx.a.txAlphaTomb = await createTransaction("a", BOOK.a, { key: "A4", categoryId: fx.a.catAlpha.id, amountCents: 4444, note: `${PREFIX}A4-tomb` });
  expectStatus(await deleteTransaction("a", BOOK.a, fx.a.txAlphaTomb.id), 204, "软删除分类夹具账目");

  fx.a.txDflt = await createTransaction("a", BOOK.a, { key: "A5", categoryId: fx.a.catDefault.id, amountCents: 555, note: `${PREFIX}A5-default` });
  fx.a.txNoBody = await createTransaction("a", BOOK.a, { key: "A6", categoryId: fx.a.catNoBody.id, amountCents: 556, note: `${PREFIX}A6-nobody` });
  fx.a.txSelf = await createTransaction("a", BOOK.a, { key: "A7", categoryId: fx.a.catSelf.id, amountCents: 557, note: `${PREFIX}A7-self` });
  fx.a.txKind = await createTransaction("a", BOOK.a, { key: "A8", categoryId: fx.a.catKind.id, amountCents: 558, note: `${PREFIX}A8-kind` });
  fx.a.txXLedger = await createTransaction("a", BOOK.a, { key: "A9", categoryId: fx.a.catXLedger.id, amountCents: 559, note: `${PREFIX}A9-xledger` });
  fx.a.txStat1 = await createTransaction("a", BOOK.a, { key: "AA", categoryId: fx.a.catStat.id, amountCents: 1500, note: `${PREFIX}AA-stat` });
  fx.a.txStat2 = await createTransaction("a", BOOK.a, { key: "AB", categoryId: fx.a.catStat.id, amountCents: 1700, currency: "USD", note: `${PREFIX}AB-stat-usd` });
  fx.a.txArch = await createTransaction("a", BOOK.a, { key: "AC", categoryId: fx.a.catArch.id, amountCents: 560, note: `${PREFIX}AC-arch` });
  fx.a.txTombOnly1 = await createTransaction("a", BOOK.a, { key: "AD", categoryId: fx.a.catTombOnly.id, amountCents: 561, note: `${PREFIX}AD-tomb1` });
  fx.a.txTombOnly2 = await createTransaction("a", BOOK.a, { key: "AE", categoryId: fx.a.catTombOnly.id, amountCents: 562, note: `${PREFIX}AE-tomb2` });
  for (const id of [fx.a.txTombOnly1.id, fx.a.txTombOnly2.id]) {
    expectStatus(await deleteTransaction("a", BOOK.a, id), 204, "软删除仅在墓碑中使用的分类夹具");
  }

  fx.a.txPay1 = await createTransaction("a", BOOK.a, { key: "BA", paymentMethodId: fx.a.pay1.id, amountCents: 1201, note: `${PREFIX}BA-pay1` });
  fx.a.txPay2 = await createTransaction("a", BOOK.a, { key: "BB", paymentMethodId: fx.a.pay1.id, amountCents: 1202, currency: "USD", note: `${PREFIX}BB-pay2` });
  fx.a.txPayTomb = await createTransaction("a", BOOK.a, { key: "BC", paymentMethodId: fx.a.pay1.id, amountCents: 1203, note: `${PREFIX}BC-pay-tomb` });
  expectStatus(await deleteTransaction("a", BOOK.a, fx.a.txPayTomb.id), 204, "软删除支付方式夹具账目");
  fx.a.txPay3 = await createTransaction("a", BOOK.a, { key: "BD", paymentMethodId: fx.a.pay3.id, amountCents: 1204, note: `${PREFIX}BD-pay3` });

  fx.a.txTag1 = await createTransaction("a", BOOK.a, { key: "CA", tagIds: [fx.a.tag1.id, fx.a.tag2.id], amountCents: 1301, note: `${PREFIX}CA-tag1` });
  fx.a.txTag2 = await createTransaction("a", BOOK.a, { key: "CB", tagIds: [fx.a.tag1.id, fx.a.tag2.id], amountCents: 1302, note: `${PREFIX}CB-tag2` });
  fx.a.txTagTombLive = await createTransaction("a", BOOK.a, { key: "CC", tagIds: [fx.a.tagTomb.id], amountCents: 1303, note: `${PREFIX}CC-tagTomb` });
  fx.a.txTagTombGone = await createTransaction("a", BOOK.a, { key: "CD", tagIds: [fx.a.tagTomb.id], amountCents: 1304, note: `${PREFIX}CD-tagTombGone` });
  expectStatus(await deleteTransaction("a", BOOK.a, fx.a.txTagTombGone.id), 204, "软删除标签夹具账目");

  // Snapshots of every fixture entry, used by the integrity checks ----------
  fx.snap = {};
  for (const [key, value] of Object.entries(fx.a)) {
    if (value && typeof value === "object" && typeof value.id === "string" && value.seq !== undefined) {
      fx.snap[key] = fullTransactionSnapshot(value);
    }
  }

  fx.ledgerA = await ledgerOf("a", BOOK.a);
  fx.ledgerB = await ledgerOf("b", BOOK.b);
  return fx;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function forEachLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export const cleanupLog = [];

async function cleanupCall(user, method, path, options, label) {
  const result = await call(user, method, path, options);
  cleanupLog.push(`${label}: ${method} ${path} → ${result.status}`);
  return result;
}

async function restoreOriginalRoles() {
  const membersA = await membersOf("a", BOOK.a);
  const memberB = membersA.members.find((member) => member.userId === USER.b.id);
  if (memberB && memberB.role !== "editor") {
    const result = await cleanupCall("a", "PATCH", `/books/members/${USER.b.id}`, { body: { role: "editor" }, book: BOOK.a }, "恢复 Test-B 在账本 A 的 editor 角色");
    cleanupLog.push(`  → ${result.status}`);
  }

  const membersB = await membersOf("b", BOOK.b);
  const memberA = membersB.members.find((member) => member.userId === USER.a.id);
  if (memberA && memberA.role !== "viewer") {
    const result = await cleanupCall("b", "PATCH", `/books/members/${USER.a.id}`, { body: { role: "viewer" }, book: BOOK.b }, "恢复 Test-A 在账本 B 的 viewer 角色");
    cleanupLog.push(`  → ${result.status}`);
  }
}

/**
 * Remove everything this run created, then put the two accounts' roles and
 * "last used ledger" back where they were. Idempotent: missing rows are fine.
 */
export async function cleanup() {
  cleanupLog.length = 0;

  // 1. roles first, so the deletes below are performed by someone who may.
  try {
    await restoreOriginalRoles();
  } catch (error) {
    cleanupLog.push(`恢复角色失败: ${String(error)}`);
  }

  // 2. every entry this run created — soft delete, whichever book it is in.
  await forEachLimit(created.transactions, 4, async (entry) => {
    const user = entry.book === BOOK.b ? "b" : "a";
    const result = await cleanupCall(user, "DELETE", `/transactions/${entry.id}`, { book: entry.book }, "软删除测试账目");
    if (![204, 404, 403].includes(result.status)) cleanupLog.push(`  → 意外状态 ${result.status}`);
  });

  // 3. tags (permanent delete/unlink).
  await forEachLimit(created.tags, 4, async (entry) => {
    const user = entry.book === BOOK.b ? "b" : "a";
    await cleanupCall(user, "DELETE", `/tags/${entry.id}`, { book: entry.book }, "删除测试标签");
  });

  // 4. payment methods (replacement = 未指定).
  await forEachLimit(created.payments, 3, async (entry) => {
    const user = entry.book === BOOK.b ? "b" : "a";
    await cleanupCall(user, "POST", `/payment-methods/${entry.id}/permanent-delete`, { body: {}, book: entry.book }, "永久删除测试支付方式");
  });

  // 5. categories (replacement = 默认「暂无分类」).
  await forEachLimit(created.categories, 3, async (entry) => {
    const user = entry.book === BOOK.b ? "b" : "a";
    await cleanupCall(user, "POST", `/categories/${entry.id}/permanent-delete`, { body: {}, book: entry.book }, "永久删除测试分类");
  });

  // 6. last-used ledger: the start page reads this, so put it back.
  await cleanupCall("a", "POST", `/books/${BOOK.a}/activate`, {}, "恢复 Test-A 上次使用账本 A");
  await cleanupCall("b", "POST", `/books/${BOOK.b}/activate`, {}, "恢复 Test-B 上次使用账本 B");

  // 7. the temporary ledgers: no delete API, so set them aside (hidden from the start page).
  for (const book of created.books) {
    const creator = book.creator === "b" ? "b" : "a";
    await cleanupCall(creator, "POST", `/books/${book.id}/dispose`, {}, `弃置临时账本 ${book.name}`);
  }

  // 8. book A's name: some tests rename it; restore the baseline name.
  const booksNow = await booksOf("a");
  const currentA = bookSummary(booksNow, BOOK.a);
  if (currentA && currentA.name !== state.books.a.name) {
    await cleanupCall("a", "PATCH", `/books/${BOOK.a}`, { body: { name: state.books.a.name }, book: BOOK.a }, "恢复账本 A 名称");
  }

  return cleanupLog.length;
}

export async function verifyBaseline() {
  const problems = [];
  const notes = [];

  for (const [key, ids] of Object.entries(BASELINE_TX)) {
    for (const id of ids) {
      const book = key === "a" ? BOOK.a : BOOK.b;
      const result = await call(key, "GET", `/transactions/${id}`, { book });
      if (result.status !== 200) {
        problems.push(`基线账目 ${id}（账本 ${key.toUpperCase()}）读取失败：HTTP ${result.status}`);
        continue;
      }
      const now = fullTransactionSnapshot(result.data);
      const before = baseline.transactions[key]?.[id];
      if (JSON.stringify(now) !== JSON.stringify(before)) {
        problems.push(`基线账目 ${id} 被改动：前 ${JSON.stringify(before)}；后 ${JSON.stringify(now)}`);
      }
    }
  }

  /**
   * Everything that was live when the run started must still be exactly as it
   * was. Missing ids and changed fields are reported separately, because an id
   * that a concurrent browser check deleted is not this script's failure.
   */
  for (const key of ["a", "b"]) {
    const user = key === "a" ? "a" : "b";
    const book = key === "a" ? BOOK.a : BOOK.b;
    const runner = key === "a" ? "a" : "b";
    for (const [id, snapshot] of Object.entries(baseline.startLive?.[key] ?? {})) {
      const result = await call(user, "GET", `/transactions/${id}`, { book });
      if (result.status === 404) {
        notes.push(`起始账目 ${id} 已不存在（可能是并发的浏览器验收删除，不是本脚本）`);
        continue;
      }
      if (result.status !== 200) {
        notes.push(`起始账目 ${id} 读取异常：HTTP ${result.status}`);
        continue;
      }
      const now = fullTransactionSnapshot(result.data);
      if (JSON.stringify(now) !== JSON.stringify(snapshot)) {
        problems.push(`起始账目 ${id} 被改动：前 ${JSON.stringify(snapshot)}；后 ${JSON.stringify(now)}`);
      }
    }
    void runner;
  }

  const booksA = await booksOf("a");
  const booksB = await booksOf("b");
  const openA = bookSummary(booksA, BOOK.a);
  const openB = bookSummary(booksB, BOOK.b);
  if (!openA || openA.name !== state.books.a.name) problems.push(`账本 A 未恢复名称/状态：${JSON.stringify(openA)}`);
  if (!openB || openB.name !== state.books.b.name) problems.push(`账本 B 未恢复名称/状态：${JSON.stringify(openB)}`);

  const membersA = await membersOf("a", BOOK.a);
  const membersB = await membersOf("b", BOOK.b);
  const roleInA = membersA.members.find((member) => member.userId === USER.b.id)?.role;
  const roleInB = membersB.members.find((member) => member.userId === USER.a.id)?.role;
  if (roleInA !== "editor") problems.push(`Test-B 在账本 A 的角色未恢复：${roleInA}`);
  if (roleInB !== "viewer") problems.push(`Test-A 在账本 B 的角色未恢复：${roleInB}`);

  const ledgerA = await ledgerOf("a", BOOK.a);
  const ledgerB = await ledgerOf("b", BOOK.b);
  if (ledgerA.stats.transactionCount !== baseline.ledger.a.stats.transactionCount) {
    notes.push(
      `账本 A 未删除账目数 ${ledgerA.stats.transactionCount}，开跑时 ${baseline.ledger.a.stats.transactionCount}（差异可能来自并发的浏览器验收）`,
    );
  }
  if (ledgerB.stats.transactionCount !== baseline.ledger.b.stats.transactionCount) {
    notes.push(
      `账本 B 未删除账目数 ${ledgerB.stats.transactionCount}，开跑时 ${baseline.ledger.b.stats.transactionCount}`,
    );
  }

  const summaryA = await summaryOf("a", BOOK.a);
  if (JSON.stringify(summaryMap(summaryA)) !== JSON.stringify(summaryMap(baseline.summary.a))) {
    notes.push(`账本 A 当月汇总与开跑时不同：前 ${JSON.stringify(baseline.summary.a)}；后 ${JSON.stringify(summaryA)}`);
  }
  const summaryB = await summaryOf("b", BOOK.b);
  if (JSON.stringify(summaryMap(summaryB)) !== JSON.stringify(summaryMap(baseline.summary.b))) {
    notes.push(`账本 B 当月汇总与开跑时不同：前 ${JSON.stringify(baseline.summary.b)}；后 ${JSON.stringify(summaryB)}`);
  }

  const usageA = await usageOf("a", BOOK.a);
  if (JSON.stringify(usageA) !== JSON.stringify(baseline.usage.a)) {
    notes.push(`账本 A classification-usage 与开跑时不同：前 ${JSON.stringify(baseline.usage.a)}；后 ${JSON.stringify(usageA)}`);
  }
  const usageB = await usageOf("b", BOOK.b);
  if (JSON.stringify(usageB) !== JSON.stringify(baseline.usage.b)) {
    notes.push(`账本 B classification-usage 与开跑时不同：前 ${JSON.stringify(baseline.usage.b)}；后 ${JSON.stringify(usageB)}`);
  }

  return { problems, notes, ledgerA, ledgerB, summaryA, summaryB, usageA, usageB, booksA, booksB, membersA, membersB };
}

export async function leftoverObjects() {
  const ledgerA = await ledgerOf("a", BOOK.a);
  const ledgerB = await ledgerOf("b", BOOK.b);
  const prefix = PREFIX;
  return {
    a: {
      categories: ledgerA.categories.filter((category) => category.name.startsWith(prefix)).map((category) => category.name),
      payments: ledgerA.paymentMethods.filter((payment) => payment.name.startsWith(prefix)).map((payment) => payment.name),
      tags: ledgerA.tags.filter((tag) => tag.name.startsWith(prefix)).map((tag) => tag.name),
    },
    b: {
      categories: ledgerB.categories.filter((category) => category.name.startsWith(prefix)).map((category) => category.name),
      payments: ledgerB.paymentMethods.filter((payment) => payment.name.startsWith(prefix)).map((payment) => payment.name),
      tags: ledgerB.tags.filter((tag) => tag.name.startsWith(prefix)).map((tag) => tag.name),
    },
  };
}

export { forEachLimit };
