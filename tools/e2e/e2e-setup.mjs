/**
 * E2E setup for the isolated local environment (API 3100, ledger_test schema `e2e`).
 * Local test data only; credentials go to a temp file outside the repository.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:3100/api/v1";
const DIR = process.env.E2E_STATE_DIR ?? join(tmpdir(), "libevra-e2e");
mkdirSync(DIR, { recursive: true });
const secrets = JSON.parse(readFileSync(join(DIR, "secrets.json"), "utf8").replace(/^\uFEFF/, ""));

const passwordA = "E2e-A-" + randomUUID().slice(0, 10);
const passwordB = "E2e-B-" + randomUUID().slice(0, 10);

async function call(path, { method = "GET", body, cookie, bookId } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (bookId) headers["x-libellum-book"] = bookId;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text === "" ? null : JSON.parse(text); } catch { data = text; }
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const session = setCookies.map((value) => value.split(";")[0]).find((value) => value.startsWith("libellum_session="));
  return { status: response.status, data, cookie: session };
}

function must(step, result, expected = 200) {
  if (result.status !== expected) throw new Error(`${step} failed: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

async function register(username, displayName, inviteCode, password) {
  return call("/auth/register", { method: "POST", body: { username, displayName, password, inviteCode } });
}
async function login(username, password) {
  const result = await call("/auth/login", { method: "POST", body: { username, password } });
  if (!result.cookie) throw new Error(`login ${username}: no session cookie`);
  return result.cookie;
}

const aRegister = await register("test_a", "E2E Test-A", secrets.inviteA, passwordA);
if (![200, 201].includes(aRegister.status)) throw new Error("register A: " + JSON.stringify(aRegister));
const bRegister = await register("test_b", "E2E Test-B", secrets.inviteB, passwordB);
if (![200, 201].includes(bRegister.status)) throw new Error("register B: " + JSON.stringify(bRegister));

const cookieA = await login("test_a", passwordA);
const cookieB = await login("test_b", passwordB);

async function createBook(cookie, name) {
  return must(`create book ${name}`, await call("/books", { method: "POST", body: { name }, cookie }), 201);
}
const bookA = await createBook(cookieA, "E2E Book A personal/shared");
const bookB = await createBook(cookieB, "E2E Book B reverse permissions");

const ledgerA0 = must("read ledger A", await call("/ledger", { cookie: cookieA, bookId: bookA.id }));
const ledgerB0 = must("read ledger B", await call("/ledger", { cookie: cookieB, bookId: bookB.id }));

async function createCategory(cookie, bookId, name, kind) {
  return must("create category", await call("/categories", { method: "POST", cookie, bookId, body: { name, kind } }), 201);
}
async function createPayment(cookie, bookId, name) {
  return must("create payment", await call("/payment-methods", { method: "POST", cookie, bookId, body: { name } }), 201);
}
async function createTag(cookie, bookId, name, color) {
  return must("create tag", await call("/tags", { method: "POST", cookie, bookId, body: { name, color } }), 201);
}

const aFood = await createCategory(cookieA, bookA.id, "E2E Food", "expense");
const aShop = await createCategory(cookieA, bookA.id, "E2E Shop", "expense");
const aSalary = await createCategory(cookieA, bookA.id, "E2E Salary", "income");
const aUnusedCategory = await createCategory(cookieA, bookA.id, "E2E Unused Category", "expense");
const bFood = await createCategory(cookieB, bookB.id, "E2E Food", "expense");
const bSalary = await createCategory(cookieB, bookB.id, "E2E Salary", "income");
const bUnusedCategory = await createCategory(cookieB, bookB.id, "E2E Unused Category", "expense");

const aPay = await createPayment(cookieA, bookA.id, "E2E PayA");
const bPay = await createPayment(cookieB, bookB.id, "E2E PayB");
const aUnusedPay = await createPayment(cookieA, bookA.id, "E2E Unused PayA");
const aTag = await createTag(cookieA, bookA.id, "E2E TagA", "#336699");
const bTag = await createTag(cookieB, bookB.id, "E2E TagB", "#996633");
const aUnusedTag = await createTag(cookieA, bookA.id, "E2E TagA2", "#669933");

const occurredAt = new Date().toISOString();
const localDate = occurredAt.slice(0, 10);

async function createTransaction(cookie, bookId, fields) {
  const id = randomUUID();
  const result = await call("/transactions", {
    method: "POST", cookie, bookId,
    body: {
      id, idempotencyKey: id, kind: "expense", amountCents: 1234, currency: "CNY",
      occurredAt, occurredLocalDate: localDate, occurredTz: "Asia/Shanghai",
      note: "E2E transaction", tagIds: [],
      ...fields,
    },
  });
  if (![200, 201].includes(result.status)) throw new Error("create transaction: " + JSON.stringify(result));
  return result.data.transaction ?? result.data;
}

const txA1 = await createTransaction(cookieA, bookA.id, { categoryId: aFood.id, paymentMethodId: aPay.id, tagIds: [aTag.id], note: "E2E A-food-1" });
const txA2 = await createTransaction(cookieA, bookA.id, { categoryId: aFood.id, paymentMethodId: aPay.id, tagIds: [aTag.id], amountCents: 5678, note: "E2E A-food-2" });
const txA3 = await createTransaction(cookieA, bookA.id, { kind: "income", categoryId: aSalary.id, paymentMethodId: aPay.id, amountCents: 100000, note: "E2E A-salary" });
const txA4 = await createTransaction(cookieA, bookA.id, { categoryId: aShop.id, paymentMethodId: aPay.id, currency: "USD", amountCents: 2500, note: "E2E A-usd" });
const txB1 = await createTransaction(cookieB, bookB.id, { categoryId: bFood.id, paymentMethodId: bPay.id, tagIds: [bTag.id], note: "E2E B-food" });

must("invite B to A", await call("/books/invite", { method: "POST", cookie: cookieA, bookId: bookA.id, body: { username: "test_b", role: "editor" } }), 201);
const bInbox = must("B notifications", await call("/notifications", { cookie: cookieB }));
const bInvite = (bInbox.notifications ?? bInbox.items ?? []).find((item) => item.bookId === bookA.id) ?? (bInbox.notifications ?? [])[0];
if (!bInvite) throw new Error("B invitation notification not found: " + JSON.stringify(bInbox));
must("B accepts A", await call(`/notifications/${bInvite.id}/decide`, { method: "POST", cookie: cookieB, body: { decision: "accepted" } }));

const membersA = must("A members", await call("/books/members", { cookie: cookieA, bookId: bookA.id }));
const bMember = membersA.members.find((member) => member.username === "test_b");
if (!bMember) throw new Error("B not a member of A: " + JSON.stringify(membersA));

must("invite A to B", await call("/books/invite", { method: "POST", cookie: cookieB, bookId: bookB.id, body: { username: "test_a", role: "viewer" } }), 201);
const aInbox = must("A notifications", await call("/notifications", { cookie: cookieA }));
const aInvite = (aInbox.notifications ?? aInbox.items ?? []).find((item) => item.bookId === bookB.id) ?? (aInbox.notifications ?? [])[0];
if (!aInvite) throw new Error("A invitation notification not found: " + JSON.stringify(aInbox));
must("A accepts B", await call(`/notifications/${aInvite.id}/decide`, { method: "POST", cookie: cookieA, body: { decision: "accepted" } }));

const membersB = must("B members", await call("/books/members", { cookie: cookieB, bookId: bookB.id }));
const aMember = membersB.members.find((member) => member.username === "test_a");
if (!aMember) throw new Error("A not a member of B");

const getUserId = (result) => result.data?.user?.id ?? result.data?.id ?? null;
const state = {
  createdAt: new Date().toISOString(),
  apiBase: BASE,
  users: {
    a: { username: "test_a", displayName: "E2E Test-A", password: passwordA, id: getUserId(aRegister) },
    b: { username: "test_b", displayName: "E2E Test-B", password: passwordB, id: getUserId(bRegister) },
  },
  books: {
    a: { id: bookA.id, name: bookA.name, number: bookA.bookNumber, creator: "test_a", sharedRole: "editor" },
    b: { id: bookB.id, name: bookB.name, number: bookB.bookNumber, creator: "test_b", sharedRole: "viewer" },
  },
  members: { a: bMember, b: aMember },
  organisers: {
    a: { foodId: aFood.id, shopId: aShop.id, salaryId: aSalary.id, unusedCategoryId: aUnusedCategory.id, payId: aPay.id, unusedPayId: aUnusedPay.id, tagId: aTag.id, unusedTagId: aUnusedTag.id, presetCategoryIds: ledgerA0.categories.map((c) => c.id), presetPaymentIds: ledgerA0.paymentMethods.map((m) => m.id) },
    b: { foodId: bFood.id, salaryId: bSalary.id, unusedCategoryId: bUnusedCategory.id, payId: bPay.id, tagId: bTag.id, presetCategoryIds: ledgerB0.categories.map((c) => c.id), presetPaymentIds: ledgerB0.paymentMethods.map((m) => m.id) },
  },
  transactions: { a: [txA1.id, txA2.id, txA3.id, txA4.id], b: [txB1.id] },
};
writeFileSync(join(DIR, "state.json"), JSON.stringify(state, null, 2));
process.stdout.write(`E2E setup complete: bookA=${bookA.id} bookB=${bookB.id} memberships verified\n`);
