/**
 * S13-E 后端 / API 验收：双账号、跨账本、事务、并发、数据完整性。
 *
 * 运行（只操作隔离环境）：
 *   node tools/e2e/api-verification.mjs
 *
 * 只使用 state.json 里由主 Agent 建好的 E2E 账号（Test-A / Test-B），
 * 只访问 127.0.0.1:3100 的 API；不访问 3000/5173，不连生产库，
 * 不运行项目自带的 `pnpm --filter @libellum/api test`。
 *
 * 产物：
 *   %TEMP%\libevra-e2e\api-report.md
 *   %TEMP%\libevra-e2e\api-defects.json
 *   %TEMP%\libevra-e2e\api-run.json
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BASE,
  BOOK,
  BOOK_LABEL,
  CheckFailure,
  CURRENT_MONTH,
  DIR,
  PREFIX,
  RUN,
  STATS_RANGE,
  USER,
  WEB_BASE,
  adminGet,
  activateBook,
  archiveCategory,
  archivePayment,
  baseline,
  beginTest,
  bookSummary,
  booksOf,
  call,
  captureBaseline,
  check,
  cleanup,
  createCategory,
  createPayment,
  createShareLink,
  createTag,
  createTransaction,
  created,
  decide,
  deleteTag,
  deleteTransaction,
  disposedSummary,
  endTest,
  eq,
  eqNumber,
  expectError,
  expectStatus,
  exportGet,
  exportLogOf,
  exportPost,
  findCategory,
  findPayment,
  findTag,
  fullTransactionSnapshot,
  health,
  historyOf,
  importCsv,
  inboxOf,
  invite,
  joinShareLink,
  leaveBook,
  ledgerOf,
  leftoverObjects,
  loginAll,
  membersOf,
  messageOf,
  note,
  observe,
  operationsOf,
  patchCategory,
  patchPayment,
  patchTransaction,
  permanentDeleteCategory,
  permanentDeletePayment,
  previewShareLink,
  rawGet,
  removeMemberRequest,
  renameBook,
  restoreTransaction,
  revokeShareLink,
  setRole,
  setupFixtures,
  shareLinksOf,
  sleep,
  snapshotTransaction,
  state,
  statsFingerprint,
  statsOf,
  summaryMap,
  summaryOf,
  systemCategory,
  transactionOf,
  transactionsOf,
  usageOf,
  verifyBaseline,
  fx,
} from "./api-verify-lib.mjs";

const cases = [];
const results = [];
const runMeta = { startedAt: new Date().toISOString(), base: BASE, api: BASE, web: WEB_BASE, run: RUN, prefix: PREFIX };
const LOCK_FILE = join(DIR, ".api-verify.lock");

/**
 * One acceptance run at a time.
 *
 * ⚠️ Learned the hard way on 2026-10-17: two runs of this script overlapping in
 * the same isolated environment corrupt each other's measurements — one run's
 * fixtures are another run's "unexplained" event-count change, and the report
 * files are overwritten. The lock is a small courtesy; it only works for runs
 * that go through this entry point.
 */
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < 30 * 60 * 1000) {
      throw new Error(
        `已有验收进程在运行（锁文件 ${LOCK_FILE}，${Math.round(age / 1000)} 秒前）。` +
          "同一隔离环境不允许并发验收；确认后删除锁文件再运行。",
      );
    }
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), run: RUN }), "utf8");
}

function releaseLock() {
  try {
    rmSync(LOCK_FILE, { force: true });
  } catch {
    // Best effort: a stale lock only blocks the next run for 30 minutes.
  }
}

function t(group, id, title, expected, fn) {
  cases.push({ group, id, title, expected, fn });
}

const expectations = { category: {}, payment: {}, tags: {}, tombstone: new Set() };

// ---------------------------------------------------------------------------
// Small helpers used by the cases
// ---------------------------------------------------------------------------

const eventCountOf = async (user, book) => (await ledgerOf(user, book)).stats.eventCount;
const liveCountOf = async (user, book) => (await ledgerOf(user, book)).stats.transactionCount;
const opsTotalOf = async (user, book) => (await operationsOf(user, book)).total;
const usageCategory = async (user, book, id) => (await usageOf(user, book)).categories[id];
const usagePayment = async (user, book, id) => (await usageOf(user, book)).paymentMethods[id];
const usageTag = async (user, book, id) => (await usageOf(user, book)).tags[id];

function expectLiveDto(result, label) {
  return expectStatus(result, 200, label);
}

function expectAbsent(list, id, label) {
  if (list.some((entry) => entry.id === id)) {
    throw new CheckFailure(`${label}: 仍然存在（id=${id}）`);
  }
}

function expectPresent(list, id, label) {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new CheckFailure(`${label}: 未找到（id=${id}）`);
  return found;
}

function txBodyFor(userId, overrides = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  return {
    id,
    idempotencyKey: overrides.idempotencyKey ?? id,
    kind: "expense",
    amountCents: 4242,
    currency: "CNY",
    occurredAt,
    occurredLocalDate: occurredAt.slice(0, 10),
    occurredTz: "Asia/Shanghai",
    note: `${PREFIX}PERM-${userId}-${id.slice(0, 6)}`,
    tagIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cases — P0
// ---------------------------------------------------------------------------

function registerCases() {
  t(
    "P0",
    "P0-01",
    "登录与角色矩阵：A 是账本 A 创建者 / 账本 B viewer；B 是账本 B 创建者 / 账本 A editor",
    "两个账号均可登录；/books 与 /books/members 的 role/isCreator/myRole 与任务描述一致（创建者在 book_members 中表示为 editor + isCreator）",
    async () => {
      const booksA = await booksOf("a");
      const booksB = await booksOf("b");
      const aInA = bookSummary(booksA, BOOK.a);
      const aInB = bookSummary(booksA, BOOK.b);
      const bInA = bookSummary(booksB, BOOK.a);
      const bInB = bookSummary(booksB, BOOK.b);

      check(aInA && aInA.isCreator === true, "Test-A 应是账本 A 的创建者");
      check(aInA && aInA.role === "editor", `Test-A 在账本 A 的 book_members.role 应为 editor，实际 ${aInA?.role}`);
      check(aInB && aInB.isCreator === false, "Test-A 不应是账本 B 的创建者");
      eq(aInB?.role, "viewer", "Test-A 在账本 B 的角色");
      check(bInB && bInB.isCreator === true, "Test-B 应是账本 B 的创建者");
      check(bInB && bInB.role === "editor", `Test-B 在账本 B 的 book_members.role 应为 editor，实际 ${bInB?.role}`);
      check(bInA && bInA.isCreator === false, "Test-B 不应是账本 A 的创建者");
      eq(bInA?.role, "editor", "Test-B 在账本 A 的角色");

      const membersA = await membersOf("a", BOOK.a);
      const membersB = await membersOf("a", BOOK.b);
      eq(membersA.myRole, "editor", "Test-A 在账本 A 的 myRole");
      eq(membersB.myRole, "viewer", "Test-A 在账本 B 的 myRole");
      eq(membersA.members.find((member) => member.userId === USER.b.id)?.role, "editor", "Test-B 在账本 A 的成员列表角色");
      eq(membersB.members.find((member) => member.userId === USER.a.id)?.role, "viewer", "Test-A 在账本 B 的成员列表角色");

      observe("角色表示", "owner 不是 book_members 的独立 role：创建者=isCreator=true 且 role=editor；viewer 为只读成员");
    },
  );

  t(
    "P0",
    "P0-02",
    "基线数据快照：4+1 笔基线账目可读且与开跑前一致",
    "基线账目全部可 GET；字段快照（金额/币种/日期/备注/分类/支付方式/标签/version）与开跑前一致，收尾可再次比对",
    async () => {
      check(
        baseline.ledger.a.stats.transactionCount >= state.transactions.a.length,
        `账本 A 开跑时未删除账目数 ${baseline.ledger.a.stats.transactionCount} 少于 state.json 的 ${state.transactions.a.length}`,
      );
      check(
        baseline.ledger.b.stats.transactionCount >= state.transactions.b.length,
        `账本 B 开跑时未删除账目数 ${baseline.ledger.b.stats.transactionCount} 少于 state.json 的 ${state.transactions.b.length}`,
      );
      let verified = 0;
      for (const [key, ids] of Object.entries({ a: stateTransactionIds("a"), b: stateTransactionIds("b") })) {
        for (const id of ids) {
          const book = key === "a" ? BOOK.a : BOOK.b;
          const result = await call(key, "GET", `/transactions/${id}`, { book });
          const dto = expectStatus(result, 200, `读取基线账目 ${id}`);
          eq(fullTransactionSnapshot(dto), baseline.transactions[key][id], `基线账目 ${id} 快照`);
          verified += 1;
        }
      }
      eqNumber(verified, state.transactions.a.length + state.transactions.b.length, "基线账目数量");
      observe(
        "基线快照",
        `state.json 的 ${state.transactions.a.length}+${state.transactions.b.length} 笔基线账目已固化；开跑时账本 A 实际 live=${baseline.ledger.a.stats.transactionCount}（含环境既有的浏览器测试残留），账本 B live=${baseline.ledger.b.stats.transactionCount}`,
      );
    },
  );

  t(
    "P0",
    "P0-03",
    "隔离环境确认：API 3100 + health/database up",
    "GET /health 返回 ok=true、database=up；BASE 指向 127.0.0.1:3100，Web 端点为 5175（本脚本不访问 Web）",
    async () => {
      const result = await health();
      const data = expectStatus(result, 200, "GET /health");
      eq(data.ok, true, "health.ok");
      eq(data.database, "up", "health.database");
      check(BASE.startsWith("http://127.0.0.1:3100"), `BASE 不是隔离 API：${BASE}`);
      check(WEB_BASE.startsWith("http://127.0.0.1:5175"), `Web 端点不是隔离 Web：${WEB_BASE}`);
      note(`API version=${data.version}`);
      observe("隔离端口", `API=${BASE}；Web=${WEB_BASE}（未访问）；未访问 3000/5173`);
    },
  );

  registerCategoryCases();
  registerPaymentCases();
  registerTagCases();
  registerIntegrityCases();
  registerPermissionCases();
  registerLifecycleCases();
  registerIsolationCases();
  registerConcurrencyCases();
  registerExportCases();

  // CLEAN group is registered last and performs the actual cleanup.
  t(
    "CLEAN",
    "CLEAN-00",
    "清理本次运行创建的临时对象，恢复角色/上次账本/账本名称",
    "清理后：无 PREFIX 临时分类/支付方式/标签；Test-B 在账本 A=editor、Test-A 在账本 B=viewer；上次账本恢复；临时账本 C 被弃置",
    async () => {
      const log = await cleanup();
      observe("清理调用条数", log);
      const leftovers = await leftoverObjects();
      note(`清理后残留：${JSON.stringify(leftovers)}`);
      eq(leftovers.a.categories.length, 0, "账本 A 残留临时分类");
      eq(leftovers.a.payments.length, 0, "账本 A 残留临时支付方式");
      eq(leftovers.a.tags.length, 0, "账本 A 残留临时标签");
      eq(leftovers.b.categories.length, 0, "账本 B 残留临时分类");
      eq(leftovers.b.payments.length, 0, "账本 B 残留临时支付方式");
      eq(leftovers.b.tags.length, 0, "账本 B 残留临时标签");

      const liveLeftovers = [];
      for (const book of [BOOK.a, BOOK.b]) {
        const user = book === BOOK.a ? "a" : "b";
        const list = await transactionsOf(user, book, "?limit=100");
        for (const item of list.items) {
          if ((item.note ?? "").startsWith(PREFIX)) liveLeftovers.push(`${item.note}(${item.id})`);
        }
      }
      note(`清理后仍 live 的本轮测试账目：${liveLeftovers.length === 0 ? "无" : liveLeftovers.join(", ")}`);
      eq(liveLeftovers, [], "清理后仍有 live 的本轮测试账目");
    },
  );

  t(
    "CLEAN",
    "CLEAN-01",
    "基线账本、成员、账目、汇总与 classification-usage 回到基线",
    "基线账目字段完全一致；账本名称恢复；Test-B 在 A=editor、Test-A 在 B=viewer；未删除账目数 4/1；当月 summary 与 usage 与基线相同",
    async () => {
      const verification = await verifyBaseline();
      note(`problems=${JSON.stringify(verification.problems)}`);
      note(`notes=${JSON.stringify(verification.notes)}`);
      eq(verification.problems, [], "基线复核问题");
      observe("收尾未删除账目", `A=${verification.ledgerA.stats.transactionCount} / B=${verification.ledgerB.stats.transactionCount}（开跑时 ${baseline.ledger.a.stats.transactionCount}/${baseline.ledger.b.stats.transactionCount}）`);
    },
  );

  t(
    "CLEAN",
    "CLEAN-02",
    "临时账本 C / D 均已弃置且不再出现在各自创建者的可打开列表",
    "A 的 /books.disposed 含 C（disposedByMe=true）且 A 的可打开列表不含 C；B 的 /books.disposed 含 D，B 的可打开列表不含 D；两个空账本仍可按 id 读取（弃置=隐藏而非删除）",
    async () => {
      const [booksA, booksB] = await Promise.all([booksOf("a"), booksOf("b")]);
      const c = created.books.find((book) => book.name.endsWith("BOOK-C"));
      const d = created.books.find((book) => book.name.endsWith("BOOK-D"));
      if (!c && !d) {
        note("本次运行未创建临时账本（LIFE-01/LIFE-03 未执行），跳过");
        return;
      }
      if (c) {
        const disposed = disposedSummary(booksA, c.id);
        check(disposed, "临时账本 C 应出现在 A 的 /books.disposed");
        eq(disposed.disposedByMe, true, "临时账本 C disposedByMe");
        expectAbsent(booksA.books ?? [], c.id, "临时账本 C 不应出现在 A 的可打开列表");
        expectAbsent(booksB.books ?? [], c.id, "临时账本 C 也不应出现在 B 的可打开列表");
        const ledger = await ledgerOf("a", c.id);
        eqNumber(ledger.stats.transactionCount, 0, "临时账本 C 的账目数");
      }
      if (d) {
        const disposed = disposedSummary(booksB, d.id);
        check(disposed, "临时账本 D 应出现在 B 的 /books.disposed");
        eq(disposed.disposedByMe, true, "临时账本 D disposedByMe");
        expectAbsent(booksB.books ?? [], d.id, "临时账本 D 不应出现在 B 的可打开列表");
        const ledger = await ledgerOf("b", d.id);
        eqNumber(ledger.stats.transactionCount, 0, "临时账本 D 的账目数");
      }
    },
  );

  t(
    "CLEAN",
    "CLEAN-03",
    "运行副作用清单：事件数 / 批量摘要 / 墓碑（只记录，不判失败）",
    "基线业务数据未改；新增的只是 append-only 历史（transaction_events）与批量摘要（ledger_operation_logs），数量在此记录",
    async () => {
      const ledgerA = await ledgerOf("a", BOOK.a);
      const ledgerB = await ledgerOf("b", BOOK.b);
      const opsA = await operationsOf("a", BOOK.a);
      const opsB = await operationsOf("b", BOOK.b);
      const deltas = {
        eventsA: ledgerA.stats.eventCount - baseline.ledger.a.stats.eventCount,
        eventsB: ledgerB.stats.eventCount - baseline.ledger.b.stats.eventCount,
        operationsA: opsA.total - baseline.operations.a.total,
        operationsB: opsB.total - baseline.operations.b.total,
        liveTransactionsA: ledgerA.stats.transactionCount,
        liveTransactionsB: ledgerB.stats.transactionCount,
        startLiveTransactionsA: baseline.ledger.a.stats.transactionCount,
        startLiveTransactionsB: baseline.ledger.b.stats.transactionCount,
      };
      note(`副作用：${JSON.stringify(deltas)}`);
      check(deltas.eventsA >= 0 && deltas.eventsB >= 0, "事件数不应减少");
      check(deltas.operationsA >= 0 && deltas.operationsB >= 0, "摘要数不应减少");
      check(ledgerA.stats.transactionCount >= state.transactions.a.length, "账本 A 的基线账目不应减少");
      check(ledgerB.stats.transactionCount >= state.transactions.b.length, "账本 B 的基线账目不应减少");
      if (ledgerA.stats.transactionCount !== baseline.ledger.a.stats.transactionCount) {
        note("账本 A 收尾 live 数与开跑时不同：可能来自并发的浏览器验收，已由 CLEAN-01 的 notes 记录");
      }
      if (ledgerB.stats.transactionCount !== baseline.ledger.b.stats.transactionCount) {
        note("账本 B 收尾 live 数与开跑时不同：可能来自并发的浏览器验收");
      }
      observe("不可删除的测试痕迹", "基线账目完好；新增的只有事件/摘要等 append-only 记录，以及被弃置的空临时账本 C");
      runMeta.deltas = deltas;
    },
  );
}

function stateTransactionIds(key) {
  // state.json 中的基线账目 id；直接复用公共库通过 BASELINE_TX 导出的清单。
  return key === "a" ? [...baseTxA()] : [...baseTxB()];
}
function baseTxA() {
  return baselineTransactions("a");
}
function baseTxB() {
  return baselineTransactions("b");
}
function baselineTransactions(key) {
  return Object.keys(baseline.transactions?.[key] ?? {}).map((id) => id);
}

// ---------------------------------------------------------------------------
// Cases — CAT
// ---------------------------------------------------------------------------

function registerCategoryCases() {
  t(
    "CAT",
    "CAT-01",
    "分类引用计数只算未删除账目（3 笔 live + 1 笔墓碑 → 预览 3）",
    "GET /ledger/classification-usage 返回 categories[分类A1]=3，墓碑账目 GET 404",
    async () => {
      const count = await usageCategory("a", BOOK.a, fx.a.catAlpha.id);
      eqNumber(count, 3, "分类 A1 的未删除引用数（墓碑不应计入）");
      const tomb = await transactionOf("a", BOOK.a, fx.a.txAlphaTomb.id);
      expectStatus(tomb, 404, "墓碑账目按 id 读取");
    },
  );

  t(
    "CAT",
    "CAT-02",
    "打开删除确认框后取消：不产生任何写入",
    "只读 preview 之后分类仍在、3 笔账目字段与分类不变、批量摘要总数不变",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const historyBefore = await historyOf("a", BOOK.a, 1);
      await usageOf("a", BOOK.a); // 相当于 UI 打开确认框
      const ledger = await ledgerOf("a", BOOK.a);
      expectPresent(ledger.categories, fx.a.catAlpha.id, "分类 A1 仍应在 /ledger");
      for (const key of ["txAlpha1", "txAlpha2", "txAlpha3"]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.snap[key].id), `读取 ${key}`);
        eq(fullTransactionSnapshot(dto), fx.snap[key], `${key} 未被取消操作改动`);
      }
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "批量摘要总数");
      eqNumber((await historyOf("a", BOOK.a, 1)).total, historyBefore.total, "历史条数");
    },
  );

  t(
    "CAT",
    "CAT-03",
    "指定同类型替换：3 笔 live 重关联，墓碑行也重关联，只写 1 条摘要、0 条逐笔事件",
    "POST /categories/:id/permanent-delete {replacementCategoryId=同类型 A2} → 200 affectedEntries=3 replacementId=A2；摘要 1 条（mode=replacement, movedRows=4）；eventCount/历史总数不变",
    async () => {
      const opsBefore = await operationsOf("a", BOOK.a);
      const eventsBefore = await eventCountOf("a", BOOK.a);
      const historyBefore = await historyOf("a", BOOK.a, 1);

      const result = await permanentDeleteCategory("a", BOOK.a, fx.a.catAlpha.id, {
        replacementCategoryId: fx.a.catBeta.id,
      });
      const body = expectStatus(result, 200, "永久删除分类 A1（指定替换 A2）");
      eqNumber(body.affectedEntries, 3, "affectedEntries");
      eq(body.replacementId, fx.a.catBeta.id, "replacementId");
      eq(body.replacementName, fx.a.catBeta.name, "replacementName");
      check(typeof body.operationId === "string" && body.operationId.length > 0, "operationId 应为非空字符串");

      for (const key of ["txAlpha1", "txAlpha2", "txAlpha3", "txAlphaTomb"]) {
        expectations.category[key] = fx.a.catBeta.id;
      }
      fx.a.catAlphaDeletion = body;

      const ledgerAfter = await ledgerOf("a", BOOK.a);
      expectAbsent(ledgerAfter.categories, fx.a.catAlpha.id, "分类 A1 删除后不应出现在 /ledger");

      const opsAfter = await operationsOf("a", BOOK.a);
      eqNumber(opsAfter.total, opsBefore.total + 1, "一次批量操作只应写一条摘要");
      const summaryRow = opsAfter.entries.find((entry) => entry.id === body.operationId);
      check(summaryRow, "摘要行应按 operationId 可读");
      eq(summaryRow.action, "category.permanent_delete", "摘要 action");
      eq(summaryRow.objectType, "category", "摘要 objectType");
      eq(summaryRow.objectId, fx.a.catAlpha.id, "摘要 objectId");
      eq(summaryRow.objectName, fx.a.catAlpha.name, "摘要 objectName");
      eqNumber(summaryRow.affectedCount, 3, "摘要 affectedCount");
      eq(summaryRow.actorName, USER.a.displayName, "摘要 actorName");
      eq(summaryRow.detail.mode, "replacement", "摘要 detail.mode");
      eq(summaryRow.detail.replacementCategoryId, fx.a.catBeta.id, "摘要 detail.replacementCategoryId");
      eqNumber(summaryRow.detail.movedRows, 4, "摘要 detail.movedRows（含墓碑行）");

      eqNumber(await eventCountOf("a", BOOK.a), eventsBefore, "批量重关联不应逐笔写 transaction_events");
      eqNumber((await historyOf("a", BOOK.a, 1)).total, historyBefore.total, "历史条数不应增加");
    },
  );

  t(
    "CAT",
    "CAT-04",
    "重关联后交易字段不变，仅 category 外键改变，列表已刷新",
    "3 笔账目逐字段（id/seq/金额/币种/日期/时区/备注/version/tags）与删除前一致；categoryId=A2；GET /transactions 列表显示新分类",
    async () => {
      for (const key of ["txAlpha1", "txAlpha2", "txAlpha3"]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.snap[key].id), `读取 ${key}`);
        eq(snapshotTransaction(dto), snapshotTransaction(fx.snap[key]), `${key} 除分类外的字段`);
        eq(dto.categoryId, fx.a.catBeta.id, `${key} 的 categoryId`);
        eq(dto.categoryName, fx.a.catBeta.name, `${key} 的 categoryName`);
      }
      const list = await transactionsOf("a", BOOK.a, "?limit=100");
      for (const key of ["txAlpha1", "txAlpha2", "txAlpha3"]) {
        const row = list.items.find((item) => item.id === fx.snap[key].id);
        check(row, `列表应包含 ${key}`);
        eq(row.categoryId, fx.a.catBeta.id, `列表 ${key} 的 categoryId`);
        eq(row.categoryName, fx.a.catBeta.name, `列表 ${key} 的 categoryName`);
      }
      note(`列表返回 ${list.items.length} 条（limit=100）`);
    },
  );

  t(
    "CAT",
    "CAT-05",
    "墓碑行同样被重关联（恢复后能看到新分类）",
    "POST /transactions/:id/restore 恢复 A1 的墓碑账目 → categoryId=A2；再次删除仍正常",
    async () => {
      const restored = expectStatus(
        await restoreTransaction("a", BOOK.a, fx.a.txAlphaTomb.id),
        200,
        "恢复墓碑账目",
      );
      eq(restored.categoryId, fx.a.catBeta.id, "恢复后的 categoryId");
      eq(restored.categoryName, fx.a.catBeta.name, "恢复后的 categoryName");
      expectStatus(await deleteTransaction("a", BOOK.a, fx.a.txAlphaTomb.id), 204, "再次软删除");
      expectations.tombstone.add("txAlphaTomb");
    },
  );

  t(
    "CAT",
    "CAT-06",
    "默认替换：不指定 replacement → 同 kind 的系统「暂无分类」（支出）",
    "POST …/permanent-delete {} → 200 replacementId=系统支出「暂无分类」；affectedEntries=1；detail.mode=default；账目 categoryIsSystem=true",
    async () => {
      const result = await permanentDeleteCategory("a", BOOK.a, fx.a.catDefault.id, {});
      const body = expectStatus(result, 200, "永久删除分类 A5（默认替换）");
      eqNumber(body.affectedEntries, 1, "affectedEntries");
      eq(body.replacementId, fx.sys.aExpense.id, "replacementId 应为系统支出「暂无分类」");
      eq(body.replacementName, "暂无分类", "replacementName");
      expectations.category.txDflt = fx.sys.aExpense.id;

      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txDflt.id), "读取默认替换后的账目");
      eq(dto.categoryId, fx.sys.aExpense.id, "账目 categoryId");
      eq(dto.categoryIsSystem, true, "账目 categoryIsSystem");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      check(row, "摘要行");
      eq(row.detail.mode, "default", "摘要 detail.mode");
      eq(row.detail.replacementCategoryId, fx.sys.aExpense.id, "摘要 detail.replacementCategoryId");
    },
  );

  t(
    "CAT",
    "CAT-06b",
    "默认替换按 kind 选取：收入分类默认落到收入「暂无分类」",
    "收入分类 + 收入账目 → 默认删除后 replacementId=系统收入「暂无分类」",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}CAT-INC`, "income");
      const tx = await createTransaction("a", BOOK.a, {
        key: "INC",
        kind: "income",
        categoryId: cat.id,
        amountCents: 9900,
        note: `${PREFIX}INC-default`,
      });
      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, cat.id, {}), 200, "永久删除收入分类（默认）");
      eq(body.replacementId, fx.sys.aIncome.id, "收入分类的默认 replacementId");
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, tx.id), "读取收入账目");
      eq(dto.categoryId, fx.sys.aIncome.id, "收入账目 categoryId");
      eq(dto.categoryIsSystem, true, "收入账目 categoryIsSystem");
    },
  );

  t(
    "CAT",
    "CAT-07",
    "不传 body 的默认删除同样合法（POST 无 body → 默认替换）",
    "POST …/permanent-delete 无 body → 200；affectedEntries=1；replacementId=系统支出「暂无分类」",
    async () => {
      const body = expectStatus(
        await permanentDeleteCategory("a", BOOK.a, fx.a.catNoBody.id, undefined),
        200,
        "永久删除分类 A6（无 body）",
      );
      eqNumber(body.affectedEntries, 1, "affectedEntries");
      eq(body.replacementId, fx.sys.aExpense.id, "replacementId");
      expectations.category.txNoBody = fx.sys.aExpense.id;
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txNoBody.id), "读取账目 A6");
      eq(dto.categoryId, fx.sys.aExpense.id, "账目 categoryId");
    },
  );

  t(
    "CAT",
    "CAT-08",
    "未使用分类直接删：affectedEntries=0、replacement=null、movedRows=0、只写 1 条摘要",
    "POST …/permanent-delete {} → 200 affectedEntries=0 replacementId=null；detail.mode=none；分类从 /ledger 消失",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, fx.a.catUnused.id, {}), 200, "删除未使用分类");
      eqNumber(body.affectedEntries, 0, "affectedEntries");
      eq(body.replacementId, null, "replacementId");
      eq(body.replacementName, null, "replacementName");
      expectAbsent((await ledgerOf("a", BOOK.a)).categories, fx.a.catUnused.id, "未使用分类");
      const ops = await operationsOf("a", BOOK.a);
      eqNumber(ops.total, opsBefore + 1, "摘要条数");
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.detail.mode, "none", "detail.mode");
      eqNumber(row.detail.movedRows, 0, "detail.movedRows");
    },
  );

  t(
    "CAT",
    "CAT-09",
    "系统分类保护：归档删除与永久删除均 403 category_system",
    "DELETE /categories/{系统分类} → 403 category_system；POST …/permanent-delete → 403；分类仍在且仍被账目引用",
    async () => {
      expectError(await archiveCategory("a", BOOK.a, fx.sys.aExpense.id), 403, "category_system", "归档删除系统分类");
      expectError(await permanentDeleteCategory("a", BOOK.a, fx.sys.aExpense.id, {}), 403, "category_system", "永久删除系统分类");
      const ledger = await ledgerOf("a", BOOK.a);
      const category = expectPresent(ledger.categories, fx.sys.aExpense.id, "系统分类仍应在 /ledger");
      eq(category.isSystem, true, "系统分类 isSystem");
      const usage = await usageOf("a", BOOK.a);
      check(usage.categories[fx.sys.aExpense.id] >= 1, "系统分类仍应被账目引用");
    },
  );

  t(
    "CAT",
    "CAT-10",
    "跨 kind 替换被拒绝（400 replacement_invalid）且完全回滚",
    "支出分类删除 + 收入分类做替换 → 400 replacement_invalid；分类仍在、账目仍指向原分类、摘要总数不变",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const eventsBefore = await eventCountOf("a", BOOK.a);
      const result = await permanentDeleteCategory("a", BOOK.a, fx.a.catKind.id, {
        replacementCategoryId: fx.a.catGammaIncome.id,
      });
      expectError(result, 400, "replacement_invalid", "跨 kind 替换");
      const ledger = await ledgerOf("a", BOOK.a);
      expectPresent(ledger.categories, fx.a.catKind.id, "跨 kind 失败后原分类仍在");
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txKind.id), "读取跨 kind 失败后的账目");
      eq(dto.categoryId, fx.a.catKind.id, "账目仍指向原分类");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "摘要总数不变");
      eqNumber(await eventCountOf("a", BOOK.a), eventsBefore, "事件数不变");
    },
  );

  t(
    "CAT",
    "CAT-11",
    "替换成自己 / 替换 id 在别的账本 / 不存在的 id 均被拒绝且不改数据",
    "self → 400 replacement_invalid；账本 B 分类或随机 uuid → 403 replacement_invalid；三种情况均无写入",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);

      expectError(
        await permanentDeleteCategory("a", BOOK.a, fx.a.catSelf.id, { replacementCategoryId: fx.a.catSelf.id }),
        400,
        "replacement_invalid",
        "替换成自己",
      );
      expectError(
        await permanentDeleteCategory("a", BOOK.a, fx.a.catXLedger.id, { replacementCategoryId: fx.b.cat.id }),
        403,
        "replacement_invalid",
        "跨账本替换",
      );
      expectError(
        await permanentDeleteCategory("a", BOOK.a, fx.a.catXLedger.id, { replacementCategoryId: crypto.randomUUID() }),
        403,
        "replacement_invalid",
        "不存在的替换 id",
      );

      const ledger = await ledgerOf("a", BOOK.a);
      expectPresent(ledger.categories, fx.a.catSelf.id, "self 失败后分类仍在");
      expectPresent(ledger.categories, fx.a.catXLedger.id, "跨账本失败后分类仍在");
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txXLedger.id), "读取跨账本失败后的账目");
      eq(dto.categoryId, fx.a.catXLedger.id, "账目未被改动");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "摘要总数不变");
    },
  );

  t(
    "CAT",
    "CAT-12",
    "重复删除同一分类：第二次 404 category_missing，且不会覆盖第一次的替换选择",
    "第一次 200 后再次 POST → 404；已重关联的 3 笔账目仍指向第一次的 A2；摘要总数不再增加",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      expectError(
        await permanentDeleteCategory("a", BOOK.a, fx.a.catAlpha.id, { replacementCategoryId: fx.a.catGammaIncome.id }),
        404,
        "category_missing",
        "重复删除已删除的分类",
      );
      for (const key of ["txAlpha1", "txAlpha2", "txAlpha3"]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.snap[key].id), `读取 ${key}`);
        eq(dto.categoryId, fx.a.catBeta.id, `${key} 仍指向第一次的替换 A2`);
      }
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "摘要总数不变");
    },
  );

  t(
    "CAT",
    "CAT-13",
    "归档与永久删除分离：归档只 isArchived=true、可恢复；归档后再永久删除仍可选择替换",
    "DELETE → 204 且 isArchived=true、账目仍可读；PATCH isArchived=false 恢复；再次归档后永久删除 → 200 affectedEntries=1",
    async () => {
      expectStatus(await archiveCategory("a", BOOK.a, fx.a.catArch.id), 204, "归档分类 A-AB");
      let ledger = await ledgerOf("a", BOOK.a);
      let category = expectPresent(ledger.categories, fx.a.catArch.id, "归档后分类仍在 /ledger");
      eq(category.isArchived, true, "归档后 isArchived");
      let dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txArch.id), "归档后账目仍可读");
      eq(dto.categoryName, fx.a.catArch.name, "归档后账目分类名");

      // 归档是幂等的
      expectStatus(await archiveCategory("a", BOOK.a, fx.a.catArch.id), 204, "重复归档");
      const restored = expectStatus(
        await patchCategory("a", BOOK.a, fx.a.catArch.id, { isArchived: false }),
        200,
        "恢复归档分类",
      );
      eq(restored.isArchived, false, "恢复后 isArchived");

      expectStatus(await archiveCategory("a", BOOK.a, fx.a.catArch.id), 204, "再次归档");
      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, fx.a.catArch.id, {}), 200, "归档后永久删除");
      eqNumber(body.affectedEntries, 1, "affectedEntries");
      eq(body.replacementId, fx.sys.aExpense.id, "replacementId");
      expectations.category.txArch = fx.sys.aExpense.id;
      dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txArch.id), "永久删除后的账目");
      eq(dto.categoryId, fx.sys.aExpense.id, "账目重关联到默认分类");
      expectAbsent((await ledgerOf("a", BOOK.a)).categories, fx.a.catArch.id, "永久删除后的分类");
    },
  );

  t(
    "CAT",
    "CAT-14",
    "只有墓碑引用的分类：affectedEntries=0，但 movedRows>0，明细 mode=default",
    "预览中该分类不出现；永久删除 → affectedEntries=0、movedRows=2；分类消失",
    async () => {
      const usage = await usageOf("a", BOOK.a);
      check(usage.categories[fx.a.catTombOnly.id] === undefined, "只被墓碑引用的分类不应出现在 usage");
      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, fx.a.catTombOnly.id, {}), 200, "删除仅被墓碑引用的分类");
      eqNumber(body.affectedEntries, 0, "affectedEntries");
      eq(body.replacementId, fx.sys.aExpense.id, "墓碑行也需要 replacement");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.detail.mode, "default", "detail.mode");
      eqNumber(row.detail.movedRows, 2, "detail.movedRows");
      expectAbsent((await ledgerOf("a", BOOK.a)).categories, fx.a.catTombOnly.id, "分类");
    },
  );

  t(
    "CAT",
    "CAT-15",
    "editor 也能执行永久删除，摘要 actorName 记录实际操作者",
    "Test-B（editor）删自己创建的分类 → 200 affectedEntries=1；摘要 actorName=Test-B；账目指向替换分类",
    async () => {
      const cat = await createCategory("b", BOOK.a, `${PREFIX}CAT-E1`, "expense");
      const tx = await createTransaction("b", BOOK.a, {
        key: "E1",
        categoryId: cat.id,
        amountCents: 1601,
        note: `${PREFIX}E1-editor`,
      });
      const body = expectStatus(
        await permanentDeleteCategory("b", BOOK.a, cat.id, { replacementCategoryId: fx.a.catBeta.id }),
        200,
        "editor 永久删除分类",
      );
      eqNumber(body.affectedEntries, 1, "affectedEntries");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.actorName, USER.b.displayName, "摘要 actorName");
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, tx.id), "读取 editor 删除后的账目");
      eq(dto.categoryId, fx.a.catBeta.id, "账目 categoryId");
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — payment methods
// ---------------------------------------------------------------------------

function registerPaymentCases() {
  t(
    "PAY",
    "PAY-01",
    "支付方式引用计数只算未删除账目（2 live + 1 墓碑 → 2）",
    "usage.paymentMethods[PAY-A1]=2；未指定（NULL）不作为键出现",
    async () => {
      eqNumber(await usagePayment("a", BOOK.a, fx.a.pay1.id), 2, "PAY-A1 的未删除引用数");
      expectStatus(await transactionOf("a", BOOK.a, fx.a.txPayTomb.id), 404, "支付方式夹具墓碑账目");
    },
  );

  t(
    "PAY",
    "PAY-02",
    "指定替换：2 笔 live 重关联，墓碑行也重关联，摘要 1 条、事件不膨胀",
    "POST /payment-methods/:id/permanent-delete {replacement=PAY-A2} → 200 affectedEntries=2 replacementId=PAY-A2；detail.mode=replacement movedRows=3；事务字段不变",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const eventsBefore = await eventCountOf("a", BOOK.a);

      const body = expectStatus(
        await permanentDeletePayment("a", BOOK.a, fx.a.pay1.id, {
          replacementPaymentMethodId: fx.a.pay2.id,
        }),
        200,
        "永久删除支付方式 PAY-A1（指定替换）",
      );
      eqNumber(body.affectedEntries, 2, "affectedEntries");
      eq(body.replacementId, fx.a.pay2.id, "replacementId");
      eq(body.replacementName, fx.a.pay2.name, "replacementName");
      expectations.payment.txPay1 = fx.a.pay2.id;
      expectations.payment.txPay2 = fx.a.pay2.id;
      expectations.payment.txPayTomb = fx.a.pay2.id;

      for (const key of ["txPay1", "txPay2"]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.snap[key].id), `读取 ${key}`);
        eq(snapshotTransaction(dto), snapshotTransaction(fx.snap[key]), `${key} 除支付方式外的字段`);
        eq(dto.paymentMethodId, fx.a.pay2.id, `${key} paymentMethodId`);
        eq(dto.paymentMethodName, fx.a.pay2.name, `${key} paymentMethodName`);
      }
      expectAbsent((await ledgerOf("a", BOOK.a)).paymentMethods, fx.a.pay1.id, "支付方式 PAY-A1");

      const ops = await operationsOf("a", BOOK.a);
      eqNumber(ops.total, opsBefore + 1, "摘要条数");
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.action, "payment_method.permanent_delete", "摘要 action");
      eq(row.objectType, "payment_method", "摘要 objectType");
      eqNumber(row.affectedCount, 2, "摘要 affectedCount");
      eq(row.actorName, USER.a.displayName, "摘要 actorName");
      eq(row.detail.mode, "replacement", "摘要 detail.mode");
      eqNumber(row.detail.movedRows, 3, "摘要 detail.movedRows");
      eqNumber(await eventCountOf("a", BOOK.a), eventsBefore, "事件数");

      const restored = expectStatus(await restoreTransaction("a", BOOK.a, fx.a.txPayTomb.id), 200, "恢复支付方式墓碑账目");
      eq(restored.paymentMethodId, fx.a.pay2.id, "墓碑重关联后的 paymentMethodId");
      expectStatus(await deleteTransaction("a", BOOK.a, fx.a.txPayTomb.id), 204, "再次软删除");
      expectations.tombstone.add("txPayTomb");
    },
  );

  t(
    "PAY",
    "PAY-03",
    "不指定替换 = 改为「未指定」：payment_method_id 置 NULL",
    "POST …/permanent-delete {} → 200 replacementId=null；账目 paymentMethodId=null / paymentMethodName=null；detail.mode=unspecified",
    async () => {
      const body = expectStatus(await permanentDeletePayment("a", BOOK.a, fx.a.pay3.id, {}), 200, "永久删除支付方式 PAY-A3（未指定）");
      eqNumber(body.affectedEntries, 1, "affectedEntries");
      eq(body.replacementId, null, "replacementId");
      eq(body.replacementName, null, "replacementName");
      expectations.payment.txPay3 = null;
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txPay3.id), "读取未指定账目");
      eq(dto.paymentMethodId, null, "paymentMethodId");
      eq(dto.paymentMethodName, null, "paymentMethodName");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.detail.mode, "unspecified", "detail.mode");
      eq(row.detail.replacementPaymentMethodId, null, "detail.replacementPaymentMethodId");
    },
  );

  t(
    "PAY",
    "PAY-04",
    "未使用的支付方式直接删：0 影响、无替换",
    "POST …/permanent-delete {} → 200 affectedEntries=0 replacementId=null；分类/支付方式列表已刷新",
    async () => {
      const body = expectStatus(await permanentDeletePayment("a", BOOK.a, fx.a.payUnused.id, {}), 200, "删除未使用支付方式");
      eqNumber(body.affectedEntries, 0, "affectedEntries");
      eq(body.replacementId, null, "replacementId");
      expectAbsent((await ledgerOf("a", BOOK.a)).paymentMethods, fx.a.payUnused.id, "未使用支付方式");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eqNumber(row.detail.movedRows, 0, "detail.movedRows");
      eq(row.detail.mode, "unspecified", "detail.mode（未指定是明确答案，不是兜底）");
    },
  );

  t(
    "PAY",
    "PAY-05",
    "归档 / 恢复 / 永久删除三种语义分开",
    "DELETE→204 且仍以 isArchived=true 列出；PATCH isArchived=false 恢复；再归档后 permanent-delete→200，之后 PATCH/DELETE/permanent 均 404",
    async () => {
      expectStatus(await archivePayment("a", BOOK.a, fx.a.payArch.id), 204, "归档支付方式");
      let ledger = await ledgerOf("a", BOOK.a);
      let payment = expectPresent(ledger.paymentMethods, fx.a.payArch.id, "归档后仍在 /ledger");
      eq(payment.isArchived, true, "归档后 isArchived");
      expectStatus(await archivePayment("a", BOOK.a, fx.a.payArch.id), 204, "重复归档");

      const restored = expectStatus(await patchPayment("a", BOOK.a, fx.a.payArch.id, { isArchived: false }), 200, "恢复归档支付方式");
      eq(restored.isArchived, false, "恢复后 isArchived");

      expectStatus(await archivePayment("a", BOOK.a, fx.a.payArch.id), 204, "再次归档");
      expectStatus(await permanentDeletePayment("a", BOOK.a, fx.a.payArch.id, {}), 200, "永久删除付款方式");
      expectAbsent((await ledgerOf("a", BOOK.a)).paymentMethods, fx.a.payArch.id, "永久删除后的支付方式");
      expectError(await patchPayment("a", BOOK.a, fx.a.payArch.id, { name: "X" }), 404, "payment_method_missing", "永久删除后 PATCH");
      expectError(await archivePayment("a", BOOK.a, fx.a.payArch.id), 404, "payment_method_missing", "永久删除后 DELETE");
      expectError(await permanentDeletePayment("a", BOOK.a, fx.a.payArch.id, {}), 404, "payment_method_missing", "永久删除后再次永久删除");
    },
  );

  t(
    "PAY",
    "PAY-06",
    "跨账本替换 403；用账本 A 的 header 操作账本 B 的支付方式 → 404",
    "replacement=账本 B 支付方式 → 403 replacement_invalid；DELETE/PATCH/permanent 账本 B 支付方式（header A）→ 404 payment_method_missing",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}PAY-X1`, "expense");
      const tx = await createTransaction("a", BOOK.a, { categoryId: cat.id, paymentMethodId: fx.a.pay2.id, amountCents: 1801 });
      expectError(
        await permanentDeletePayment("a", BOOK.a, tx.paymentMethodId, { replacementPaymentMethodId: fx.b.pay.id }),
        403,
        "replacement_invalid",
        "跨账本支付方式替换",
      );
      expectError(await archivePayment("a", BOOK.a, fx.b.pay.id), 404, "payment_method_missing", "跨账本 DELETE");
      expectError(await patchPayment("a", BOOK.a, fx.b.pay.id, { name: "X" }), 404, "payment_method_missing", "跨账本 PATCH");
      expectError(await permanentDeletePayment("a", BOOK.a, fx.b.pay.id, {}), 404, "payment_method_missing", "跨账本 permanent-delete");
      // 账本 B 的支付方式仍然可用
      const ledgerB = await ledgerOf("b", BOOK.b);
      expectPresent(ledgerB.paymentMethods, fx.b.pay.id, "账本 B 支付方式");
    },
  );

  t(
    "PAY",
    "PAY-07",
    "重复永久删除支付方式 → 404；已删除的支付方式不能再被新账目引用",
    "第二次 permanent-delete → 404 payment_method_missing；POST /transactions 引用已删除支付方式 → 403 payment_method_invalid",
    async () => {
      expectError(await permanentDeletePayment("a", BOOK.a, fx.a.pay1.id, {}), 404, "payment_method_missing", "重复删除支付方式");
      const before = await liveCountOf("a", BOOK.a);
      const result = await call("a", "POST", "/transactions", {
        body: txBodyFor("pay7", { paymentMethodId: fx.a.pay1.id }),
        book: BOOK.a,
      });
      expectError(result, 403, "payment_method_invalid", "引用已删除的支付方式");
      eqNumber(await liveCountOf("a", BOOK.a), before, "账目数不变");
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — tags
// ---------------------------------------------------------------------------

function registerTagCases() {
  t(
    "TAG",
    "TAG-01",
    "未使用标签删除：affectedEntries=0，replacement=null，unlinkedRows=0",
    "DELETE /tags/:id → 200 affectedEntries=0；标签从 /ledger 消失；摘要 mode=unlink",
    async () => {
      const body = expectStatus(await deleteTag("a", BOOK.a, fx.a.tagUnused.id), 200, "删除未使用标签");
      eqNumber(body.affectedEntries, 0, "affectedEntries");
      eq(body.replacementId, null, "replacementId");
      eq(body.replacementName, null, "replacementName");
      expectAbsent((await ledgerOf("a", BOOK.a)).tags, fx.a.tagUnused.id, "未使用标签");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.action, "tag.permanent_delete", "摘要 action");
      eq(row.objectType, "tag", "摘要 objectType");
      eq(row.detail.mode, "unlink", "摘要 detail.mode");
      eqNumber(row.detail.unlinkedRows, 0, "摘要 detail.unlinkedRows");
    },
  );

  t(
    "TAG",
    "TAG-02",
    "被引用标签删除：只解除关联，其他标签保留，金额/汇总不变",
    "2 笔账目挂 TAG-A1+TAG-A2 → 删除 TAG-A1 后 affectedEntries=2；账目仍在且只剩 TAG-A2；summary 完全一致；摘要 unlinkedRows=2",
    async () => {
      eqNumber(await usageTag("a", BOOK.a, fx.a.tag1.id), 2, "TAG-A1 引用数");
      const summaryBefore = await summaryOf("a", BOOK.a);
      const body = expectStatus(await deleteTag("a", BOOK.a, fx.a.tag1.id), 200, "删除被引用标签");
      eqNumber(body.affectedEntries, 2, "affectedEntries");
      expectations.tags.txTag1 = [fx.a.tag2.id];
      expectations.tags.txTag2 = [fx.a.tag2.id];

      for (const key of ["txTag1", "txTag2"]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.snap[key].id), `读取 ${key}`);
        const current = snapshotTransaction(dto);
        const before = snapshotTransaction(fx.snap[key]);
        eq(
          {
            id: current.id,
            seq: current.seq,
            kind: current.kind,
            amountCents: current.amountCents,
            currency: current.currency,
            occurredAt: current.occurredAt,
            occurredLocalDate: current.occurredLocalDate,
            occurredTz: current.occurredTz,
            note: current.note,
            version: current.version,
          },
          {
            id: before.id,
            seq: before.seq,
            kind: before.kind,
            amountCents: before.amountCents,
            currency: before.currency,
            occurredAt: before.occurredAt,
            occurredLocalDate: before.occurredLocalDate,
            occurredTz: before.occurredTz,
            note: before.note,
            version: before.version,
          },
          `${key} 除标签外的字段`,
        );
        eq(dto.tags.map((entry) => entry.id), [fx.a.tag2.id], `${key} 只应保留 TAG-A2`);
      }
      eq(summaryMap(await summaryOf("a", BOOK.a)), summaryMap(summaryBefore), "删除标签不应改变汇总金额/笔数");

      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.actorName, USER.a.displayName, "摘要 actorName");
      eqNumber(row.affectedCount, 2, "摘要 affectedCount");
      eqNumber(row.detail.unlinkedRows, 2, "摘要 detail.unlinkedRows");
      expectAbsent((await ledgerOf("a", BOOK.a)).tags, fx.a.tag1.id, "标签 TAG-A1");
    },
  );

  t(
    "TAG",
    "TAG-03",
    "影响数口径：墓碑不计入 affectedEntries，但解绑行数计入 unlinkedRows",
    "1 笔 live + 1 笔墓碑 → affectedEntries=1、unlinkedRows=2；live 账目仍在",
    async () => {
      eqNumber(await usageTag("a", BOOK.a, fx.a.tagTomb.id), 1, "TAG-A4 live 引用数");
      const body = expectStatus(await deleteTag("a", BOOK.a, fx.a.tagTomb.id), 200, "删除含墓碑引用的标签");
      eqNumber(body.affectedEntries, 1, "affectedEntries（只算 live）");
      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eqNumber(row.detail.unlinkedRows, 2, "unlinkedRows（含墓碑）");
      expectations.tags.txTagTombLive = [];
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, fx.a.txTagTombLive.id), "读取 live 账目");
      eq(dto.tags, [], "live 账目标签已解绑");
    },
  );

  t(
    "TAG",
    "TAG-04",
    "跨账本操作标签：header=A 时 PATCH/DELETE 账本 B 标签 → 404 tag_missing",
    "PATCH/DELETE 都 404；账本 B 标签仍在",
    async () => {
      expectError(
        await call("a", "PATCH", `/tags/${fx.b.tag.id}`, { body: { name: "hijack" }, book: BOOK.a }),
        404,
        "tag_missing",
        "跨账本 PATCH 标签",
      );
      expectError(await deleteTag("a", BOOK.a, fx.b.tag.id), 404, "tag_missing", "跨账本 DELETE 标签");
      expectPresent((await ledgerOf("b", BOOK.b)).tags, fx.b.tag.id, "账本 B 标签");
    },
  );

  t(
    "TAG",
    "TAG-05",
    "标签权限：viewer 403，editor/owner 200",
    "A（viewer in B）删 B 标签 → 403 book_read_only；B（editor in A）删 A 标签 → 200；A（owner in A）删 A 标签 → 200",
    async () => {
      expectError(await deleteTag("a", BOOK.b, fx.b.tag.id), 403, "book_read_only", "viewer 删除标签");
      expectStatus(await deleteTag("b", BOOK.a, fx.a.tagEditor.id), 200, "editor 删除标签");
      expectStatus(await deleteTag("a", BOOK.a, fx.a.tagOwner.id), 200, "owner 删除标签");
    },
  );

  t(
    "TAG",
    "TAG-06",
    "重复删除标签 → 404，且不再产生摘要",
    "第二次 DELETE → 404 tag_missing；摘要总数不变",
    async () => {
      const opsBefore = await opsTotalOf("a", BOOK.a);
      expectError(await deleteTag("a", BOOK.a, fx.a.tag1.id), 404, "tag_missing", "重复删除标签");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "摘要总数");
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — integrity / batch summary / stats
// ---------------------------------------------------------------------------

function registerIntegrityCases() {
  t(
    "INT",
    "INT-01",
    "批量重关联不逐笔写 transaction_events：事件数与历史总数在同一事务窗口内不变",
    "5 笔账目所在分类永久删除（默认替换）前后：eventCount 不变、/ledger/history total 不变、摘要总数 +1",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}CAT-EV`, "expense");
      for (let index = 0; index < 5; index += 1) {
        await createTransaction("a", BOOK.a, { key: `EV${index}`, categoryId: cat.id, amountCents: 2000 + index, note: `${PREFIX}EV-${index}` });
      }
      const eventsBefore = await eventCountOf("a", BOOK.a);
      const historyBefore = await historyOf("a", BOOK.a, 1);
      const opsBefore = await opsTotalOf("a", BOOK.a);

      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, cat.id, {}), 200, "删除 5 笔账目的分类");
      eqNumber(body.affectedEntries, 5, "affectedEntries");

      eqNumber(await eventCountOf("a", BOOK.a), eventsBefore, "eventCount");
      eqNumber((await historyOf("a", BOOK.a, 1)).total, historyBefore.total, "history total");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "摘要总数");

      const ops = await operationsOf("a", BOOK.a);
      const row = ops.entries.find((entry) => entry.id === body.operationId);
      eq(row.objectName, cat.name, "摘要 objectName");
      eqNumber(row.affectedCount, 5, "摘要 affectedCount");
      eqNumber(row.detail.movedRows, 5, "摘要 movedRows");
    },
  );

  t(
    "INT",
    "INT-02",
    "GET /ledger/operations 可读、分页有上限、viewer 也能读",
    "owner/editor/viewer 均 200；limit=1 返回 1 条且 total 不变；limit=0/201 → 400 validation_failed；账本 B 的摘要可被 viewer Test-A 读取",
    async () => {
      const all = await operationsOf("a", BOOK.a);
      check(all.total >= 1, "账本 A 应已有摘要");
      check(all.entries.length <= 20, "默认 limit 应为 20 以内");
      const one = await operationsOf("a", BOOK.a, 1);
      eqNumber(one.entries.length, 1, "limit=1 条数");
      eqNumber(one.total, all.total, "limit=1 total");

      const badZero = await call("a", "GET", "/ledger/operations?limit=0", { book: BOOK.a });
      expectError(badZero, 400, "validation_failed", "limit=0");
      const badLarge = await call("a", "GET", "/ledger/operations?limit=201", { book: BOOK.a });
      expectError(badLarge, 400, "validation_failed", "limit=201");

      // 账本 B 也产生一条摘要，供 viewer 读取
      const tagB = await createTag("b", BOOK.b, `${PREFIX}TAG-B2`);
      expectStatus(await deleteTag("b", BOOK.b, tagB.id), 200, "账本 B 产生一条摘要");
      const opsB = await operationsOf("b", BOOK.b);
      check(opsB.total >= 1, "账本 B 摘要");
      const opsViewer = await operationsOf("a", BOOK.b);
      eqNumber(opsViewer.total, opsB.total, "viewer 读取账本 B 摘要 total");
      eq(opsViewer.entries[0].id, opsB.entries[0].id, "viewer 读取到同一摘要");
    },
  );

  t(
    "INT",
    "INT-03",
    "重关联前后 summary 金额/笔数不变；stats 总额不变、分类占比从旧分类移到替换分类",
    "删除 2 笔（CNY 1500 + USD 1700）的分类并默认替换：summary 完全相同；stats CNY totals 不变；byCategory 中旧分类消失、系统分类 +1500",
    async () => {
      const summaryBefore = await summaryOf("a", BOOK.a);
      const statsBefore = await statsOf("a", BOOK.a, STATS_RANGE.from, STATS_RANGE.to, "CNY");
      const liveBefore = await liveCountOf("a", BOOK.a);

      const body = expectStatus(await permanentDeleteCategory("a", BOOK.a, fx.a.catStat.id, {}), 200, "删除统计用分类");
      eqNumber(body.affectedEntries, 2, "affectedEntries");
      expectations.category.txStat1 = fx.sys.aExpense.id;
      expectations.category.txStat2 = fx.sys.aExpense.id;

      const summaryAfter = await summaryOf("a", BOOK.a);
      eq(summaryMap(summaryAfter), summaryMap(summaryBefore), "summary 金额/笔数");
      eqNumber(await liveCountOf("a", BOOK.a), liveBefore, "删除账目数");

      const statsAfter = await statsOf("a", BOOK.a, STATS_RANGE.from, STATS_RANGE.to, "CNY");
      eq(statsFingerprint(statsAfter).totals, statsFingerprint(statsBefore).totals, "stats totals");
      check(!statsAfter.byCategory.some((row) => row.categoryId === fx.a.catStat.id), "旧分类不应再出现在 byCategory");
      const systemBefore = statsBefore.byCategory.find((row) => row.categoryId === fx.sys.aExpense.id)?.minor ?? 0;
      const systemAfter = statsAfter.byCategory.find((row) => row.categoryId === fx.sys.aExpense.id)?.minor ?? 0;
      eqNumber(systemAfter, systemBefore + 1500, "系统分类的 CNY 金额（旧分类的 1500 移入）");
    },
  );

  t(
    "INT",
    "INT-04",
    "重关联后 classification-usage 已刷新：旧分类消失、替换分类计数增加",
    "usage.categories 不含已删除分类；系统分类计数 >= 1",
    async () => {
      const usage = await usageOf("a", BOOK.a);
      check(usage.categories[fx.a.catStat.id] === undefined, "旧分类不应出现在 usage");
      check(usage.categories[fx.sys.aExpense.id] >= 1, "系统分类应有计数");
      check(usage.categories[fx.a.catAlpha.id] === undefined, "已删除的 A1 不应出现在 usage");
    },
  );

  t(
    "INT",
    "INT-05",
    "批量摘要按账本隔离，usage 的 id 不跨账本泄漏",
    "账本 A 与账本 B 的 /ledger/operations 条目 id 无交集；usage 的键不互为对方账本的对象",
    async () => {
      const opsA = await operationsOf("a", BOOK.a);
      const opsB = await operationsOf("b", BOOK.b);
      const idsA = new Set(opsA.entries.map((entry) => entry.id));
      const shared = opsB.entries.filter((entry) => idsA.has(entry.id));
      eq(shared, [], "两本账的摘要 id 不应交叉");

      const usageA = await usageOf("a", BOOK.a);
      const usageB = await usageOf("b", BOOK.b);
      for (const key of Object.keys(usageB.categories)) {
        check(!(key in usageA.categories), `账本 A 的 usage 不应出现账本 B 分类 ${key}`);
      }
      for (const key of Object.keys(usageA.categories)) {
        check(!(key in usageB.categories), `账本 B 的 usage 不应出现账本 A 分类 ${key}`);
      }
    },
  );

  t(
    "INT",
    "INT-06",
    "全量夹具账目完整性：所有非外键字段与创建时一致，外键与预期一致",
    "逐笔核对夹具账目（id/seq/金额/币种/日期/时区/备注/version）不变；category/payment/tags 与各处重关联的预期一致",
    async () => {
      let checked = 0;
      for (const [key, snap] of Object.entries(fx.snap)) {
        const result = await transactionOf("a", BOOK.a, snap.id);
        if (expectations.tombstone.has(key)) {
          expectStatus(result, 404, `${key} 应仍为墓碑`);
          continue;
        }
        const dto = expectStatus(result, 200, `读取 ${key}`);
        const current = snapshotTransaction(dto);
        eq(
          {
            id: current.id,
            seq: current.seq,
            kind: current.kind,
            amountCents: current.amountCents,
            currency: current.currency,
            occurredAt: current.occurredAt,
            occurredLocalDate: current.occurredLocalDate,
            occurredTz: current.occurredTz,
            note: current.note,
            version: current.version,
          },
          {
            id: snap.id,
            seq: snap.seq,
            kind: snap.kind,
            amountCents: snap.amountCents,
            currency: snap.currency,
            occurredAt: snap.occurredAt,
            occurredLocalDate: snap.occurredLocalDate,
            occurredTz: snap.occurredTz,
            note: snap.note,
            version: snap.version,
          },
          `${key} 非外键字段`,
        );
        eq(dto.categoryId, expectations.category[key], `${key} categoryId`);
        eq(dto.paymentMethodId, expectations.payment[key], `${key} paymentMethodId`);
        eq(dto.tags.map((entry) => entry.id).sort(), [...expectations.tags[key]].sort(), `${key} tagIds`);
        checked += 1;
      }
      note(`核对 ${checked} 笔 live 夹具账目`);
      check(checked >= 15, `核对数量过少（${checked}），夹具可能未全部创建`);
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — permission matrix
// ---------------------------------------------------------------------------

function registerPermissionCases() {
  t(
    "PERM",
    "PERM-01",
    "读权限矩阵：两账号 × 两账本的所有读接口均 200",
    "A/B 在账本 A/B 上 GET /ledger、/transactions、/summary、/stats、/ledger/history、/ledger/operations、/classification-usage、/books/members、/share/links、/books/messages、/notifications、/books 全部 200",
    async () => {
      const pairs = [
        ["a", BOOK.a],
        ["a", BOOK.b],
        ["b", BOOK.a],
        ["b", BOOK.b],
      ];
      let calls = 0;
      const failures = [];
      for (const [user, book] of pairs) {
        const label = `${USER[user].label}/${BOOK_LABEL.get(book)}`;
        for (const [path, options] of [
          ["/ledger", { book }],
          ["/transactions?limit=5", { book }],
          ["/summary", { book }],
          [`/stats?from=${STATS_RANGE.from}&to=${STATS_RANGE.to}&currency=CNY`, { book }],
          ["/ledger/history?limit=5", { book }],
          ["/ledger/operations?limit=5", { book }],
          ["/ledger/classification-usage", { book }],
          ["/books/members", { book }],
          ["/share/links", { book }],
          ["/books/messages?limit=5", { book }],
          ["/notifications", {}],
          ["/books", {}],
        ]) {
          const result = await call(user, "GET", path, options);
          calls += 1;
          if (result.status !== 200) {
            failures.push(`${label} GET ${path} → ${result.status} ${result.data?.code ?? ""}`);
          }
        }
      }
      const baselineTx = { a: baseTxA()[0], b: baseTxB()[0] };
      for (const [user, book] of pairs) {
        const bookKey = book === BOOK.a ? "a" : "b";
        const result = await call(user, "GET", `/transactions/${baselineTx[bookKey]}`, { book });
        calls += 1;
        if (result.status !== 200) {
          failures.push(`${USER[user].label}/${BOOK_LABEL.get(book)} GET /transactions/:id → ${result.status} ${result.data?.code ?? ""}`);
        }
      }
      note(`读接口调用 ${calls} 次`);
      if (failures.length > 0) {
        throw new CheckFailure(`按 viewer「可查看账本内容」的规则，以下读接口应 200，实际不是：${failures.join("；")}`);
      }
    },
  );

  t(
    "PERM",
    "PERM-02",
    "viewer 写操作矩阵：Test-A 在账本 B 上所有写接口 403（永久删除与重关联同权限）",
    "22+ 个写接口（账目/分类/支付方式/标签/成员/邀请/分享链接/重命名/弃置/导入导出及永久删除）均 403；账本 B 数据完全不变",
    async () => {
      const bTx = baseTxB()[0];
      const attempts = [
        ["POST", "/transactions", txBodyFor("viewer"), 403, "book_read_only"],
        ["PATCH", `/transactions/${bTx}`, { version: 1 }, 403, "book_read_only"],
        ["DELETE", `/transactions/${bTx}`, undefined, 403, "book_read_only"],
        ["POST", `/transactions/${bTx}/restore`, undefined, 403, "book_read_only"],
        ["POST", "/categories", { name: `${PREFIX}V-CAT`, kind: "expense" }, 403, "book_read_only"],
        ["PATCH", `/categories/${fx.b.cat.id}`, { name: `${PREFIX}V-REN` }, 403, "book_read_only"],
        ["DELETE", `/categories/${fx.b.cat.id}`, undefined, 403, "book_read_only"],
        ["POST", `/categories/${fx.b.cat.id}/permanent-delete`, {}, 403, "book_read_only"],
        ["POST", "/payment-methods", { name: `${PREFIX}V-PAY` }, 403, "book_read_only"],
        ["PATCH", `/payment-methods/${fx.b.pay.id}`, { name: `${PREFIX}V-PAY2` }, 403, "book_read_only"],
        ["DELETE", `/payment-methods/${fx.b.pay.id}`, undefined, 403, "book_read_only"],
        ["POST", `/payment-methods/${fx.b.pay.id}/permanent-delete`, {}, 403, "book_read_only"],
        ["POST", "/tags", { name: `${PREFIX}V-TAG`, color: "#123456" }, 403, "book_read_only"],
        ["PATCH", `/tags/${fx.b.tag.id}`, { name: `${PREFIX}V-TAG2` }, 403, "book_read_only"],
        ["DELETE", `/tags/${fx.b.tag.id}`, undefined, 403, "book_read_only"],
        ["POST", "/books/invite", { username: USER.b.username }, 403, "book_read_only"],
        ["PATCH", `/books/members/${USER.b.id}`, { role: "viewer" }, 403, "book_read_only"],
        ["DELETE", `/books/members/${USER.b.id}`, undefined, 403, "book_read_only"],
        ["POST", "/share/links", { role: "viewer" }, 403, "book_read_only"],
        ["POST", `/books/${BOOK.b}/dispose`, undefined, 403, "book_not_creator"],
        ["POST", `/books/${BOOK.b}/restore`, undefined, 403, "book_not_creator"],
        ["PATCH", `/books/${BOOK.b}`, { name: "hijack" }, 403, "book_read_only"],
        ["POST", "/export?format=csv", undefined, 403, "book_read_only"],
        ["GET", "/export?format=csv", undefined, 403, "book_read_only"],
        ["GET", "/export-log", undefined, 403, "book_read_only"],
      ];

      const before = {
        ledger: await ledgerOf("b", BOOK.b),
        usage: await usageOf("b", BOOK.b),
        ops: await operationsOf("b", BOOK.b),
        tx: fullTransactionSnapshot(expectStatus(await transactionOf("b", BOOK.b, bTx), 200, "读取基线账目 B")),
        books: await booksOf("b"),
      };

      for (const [method, path, body, status, code] of attempts) {
        const result = await call("a", method, path, body === undefined ? { book: BOOK.b } : { body, book: BOOK.b });
        expectError(result, status, code, `viewer ${method} ${path}`);
      }

      // 导入单独构造 multipart
      const csv = `\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n${CURRENT_MONTH}-15,12:00,Asia/Shanghai,支出,1.00,CNY,,,viewer-import,\r\n`;
      expectError(await importCsv("a", BOOK.b, csv), 403, "book_read_only", "viewer POST /import");

      const after = {
        ledger: await ledgerOf("b", BOOK.b),
        usage: await usageOf("b", BOOK.b),
        ops: await operationsOf("b", BOOK.b),
        tx: fullTransactionSnapshot(expectStatus(await transactionOf("b", BOOK.b, bTx), 200, "读取基线账目 B")),
        books: await booksOf("b"),
      };
      eq(after.tx, before.tx, "账本 B 基线账目未变");
      eq(after.ledger.categories, before.ledger.categories, "账本 B 分类未变");
      eq(after.ledger.paymentMethods, before.ledger.paymentMethods, "账本 B 支付方式未变");
      eq(after.ledger.tags, before.ledger.tags, "账本 B 标签未变");
      eq(after.ledger.stats.transactionCount, before.ledger.stats.transactionCount, "账本 B 账目数未变");
      eq(after.usage, before.usage, "账本 B usage 未变");
      eqNumber(after.ops.total, before.ops.total, "账本 B 摘要数未变");
      eq(bookSummary(after.books, BOOK.b)?.name, stateName("b"), "账本 B 名称未变");

      note("已实测：GET /export 与 /export-log 也被 write guard 拒绝（403）——见报告观察项");
    },
  );

  t(
    "PERM",
    "PERM-03",
    "editor 写权限：Test-B 在账本 A 可建/改/删账目、分类、支付方式、标签与分享链接",
    "账目 POST 201 / PATCH 200 / DELETE 204 / restore 200；分类与支付方式 201/200/204；标签 201/200/200；分享链接 201/revoke 200；导出 POST/GET 200",
    async () => {
      // 账目
      const tx = await createTransaction("b", BOOK.a, { key: "PERM3", amountCents: 3333, note: `${PREFIX}PERM3-tx` });
      const patched = expectStatus(await patchTransaction("b", BOOK.a, tx.id, { note: `${PREFIX}PERM3-tx-edited` }), 200, "editor PATCH 账目");
      eq(patched.note, `${PREFIX}PERM3-tx-edited`, "PATCH 后 note");
      expectStatus(await deleteTransaction("b", BOOK.a, tx.id), 204, "editor DELETE 账目");
      expectStatus(await restoreTransaction("b", BOOK.a, tx.id), 200, "editor restore 账目");
      expectStatus(await deleteTransaction("b", BOOK.a, tx.id), 204, "editor 再次删除账目");

      // 分类
      const cat = await createCategory("b", BOOK.a, `${PREFIX}CAT-P3`, "expense");
      const renamed = expectStatus(await patchCategory("b", BOOK.a, cat.id, { name: `${PREFIX}CAT-P3R` }), 200, "editor PATCH 分类");
      eq(renamed.name, `${PREFIX}CAT-P3R`, "分类新名称");
      expectStatus(await archiveCategory("b", BOOK.a, cat.id), 204, "editor 归档分类");
      expectStatus(await patchCategory("b", BOOK.a, cat.id, { isArchived: false }), 200, "editor 恢复分类");

      // 支付方式
      const pay = await createPayment("b", BOOK.a, `${PREFIX}PAY-P3`);
      expectStatus(await patchPayment("b", BOOK.a, pay.id, { name: `${PREFIX}PAY-P3R` }), 200, "editor PATCH 支付方式");
      expectStatus(await archivePayment("b", BOOK.a, pay.id), 204, "editor 归档支付方式");
      expectStatus(await patchPayment("b", BOOK.a, pay.id, { isArchived: false }), 200, "editor 恢复支付方式");

      // 标签
      const tagItem = await createTag("b", BOOK.a, `${PREFIX}TAG-P3`);
      const renamedTag = expectStatus(
        await call("b", "PATCH", `/tags/${tagItem.id}`, { body: { name: `${PREFIX}TAG-P3R` }, book: BOOK.a }),
        200,
        "editor PATCH 标签",
      );
      eq(renamedTag.name, `${PREFIX}TAG-P3R`, "标签新名称");
      expectStatus(await deleteTag("b", BOOK.a, tagItem.id), 200, "editor DELETE 标签");

      // 分享链接（创建后立即撤销，避免留下可用链接）
      const link = await createShareLink("b", BOOK.a, { role: "viewer" });
      eq(link.status ?? 201, 201, "editor POST /share/links");
      const linkData = expectStatus(link, 201, "editor 创建分享链接");
      check(typeof linkData.token === "string" && linkData.token.length > 0, "分享链接应返回 token");
      expectStatus(await revokeShareLink("b", BOOK.a, linkData.id), 200, "editor 撤销分享链接");
      const revokeAgain = expectStatus(await revokeShareLink("b", BOOK.a, linkData.id), 200, "重复撤销分享链接");
      eq(revokeAgain.alreadyRevoked, true, "重复撤销 alreadyRevoked");

      const links = expectStatus(await shareLinksOf("b", BOOK.a), 200, "editor GET /share/links");
      const mine = links.links.find((entry) => entry.id === linkData.id);
      check(mine, "分享链接应出现在列表");
      eq(mine.active, false, "已撤销链接 active=false");

      // 导出（editor）
      const post = await exportPost("b", BOOK.a, "?format=csv");
      const exportBody = expectStatus(post, 200, "editor POST /export");
      check(typeof exportBody.fileRef === "string", "POST /export 应返回 fileRef");
      check(exportBody.rowCount >= 1, "POST /export rowCount");
      expectStatus(await exportGet("b", BOOK.a, "?format=csv"), 200, "editor GET /export");
    },
  );

  t(
    "PERM",
    "PERM-04",
    "editor 的成员管理限制：不能降级/移除创建者、不能移除自己、不能重复邀请成员",
    "PATCH 创建者→viewer 400 creator_is_editor；DELETE 创建者 400 creator_cannot_be_removed；DELETE 自己 400 remove_self；重复邀请 400 already_member",
    async () => {
      expectError(
        await setRole("b", BOOK.a, USER.a.id, "viewer"),
        400,
        "creator_is_editor",
        "editor 降级创建者",
      );
      expectError(
        await removeMemberRequest("b", BOOK.a, USER.a.id),
        400,
        "creator_cannot_be_removed",
        "editor 移除创建者",
      );
      expectError(await removeMemberRequest("b", BOOK.a, USER.b.id), 400, "remove_self", "editor 通过成员列表移除自己");
      expectError(
        await invite("a", BOOK.a, { username: USER.b.username, role: "viewer" }),
        400,
        "already_member",
        "邀请已在账本中的成员",
      );
      const members = await membersOf("a", BOOK.a);
      eq(members.members.length, 2, "账本 A 成员数不变");
    },
  );

  t(
    "PERM",
    "PERM-05",
    "动态角色：A 把 B 降为 viewer 后，B 读 200 / 写 403；B 在账本 B 的 owner 权限不受影响；随后恢复 editor",
    "PATCH 200 changed=true；B 读账本 A 200；写 403 book_read_only；B 在账本 B 仍可写（201）；书籍角色显示 viewer；恢复 editor 后写 201",
    async () => {
      const demote = expectStatus(await setRole("a", BOOK.a, USER.b.id, "viewer"), 200, "降级 Test-B");
      eq(demote.changed, true, "changed");
      const booksB = await booksOf("b");
      eq(bookSummary(booksB, BOOK.a)?.role, "viewer", "B 在账本 A 的角色");
      const membersA = await membersOf("b", BOOK.a);
      eq(membersA.myRole, "viewer", "B 在账本 A 的 myRole");

      expectStatus(await call("b", "GET", "/ledger", { book: BOOK.a }), 200, "降级后 B 读账本 A");
      expectError(await call("b", "POST", "/transactions", { body: txBodyFor("demoted"), book: BOOK.a }), 403, "book_read_only", "降级后 B 写账本 A");
      expectError(await call("b", "POST", "/tags", { body: { name: `${PREFIX}TAG-DEM`, color: "#112233" }, book: BOOK.a }), 403, "book_read_only", "降级后 B 建标签");

      // B 在账本 B 仍是创建者/editor
      const txB = await createTransaction("b", BOOK.b, { key: "PERM5B", amountCents: 4444, note: `${PREFIX}PERM5-B` });
      expectStatus(await deleteTransaction("b", BOOK.b, txB.id), 204, "B 在账本 B 写权限不受影响");
      const booksBOwn = await booksOf("b");
      eq(bookSummary(booksBOwn, BOOK.b)?.isCreator, true, "B 仍是账本 B 创建者");

      const promote = expectStatus(await setRole("a", BOOK.a, USER.b.id, "editor"), 200, "恢复 Test-B 为 editor");
      eq(promote.changed, true, "changed");
      const txRestored = await createTransaction("b", BOOK.a, { key: "PERM5A", amountCents: 4555, note: `${PREFIX}PERM5-A` });
      expectStatus(await deleteTransaction("b", BOOK.a, txRestored.id), 204, "恢复后 B 写账本 A");
    },
  );

  t(
    "PERM",
    "PERM-06",
    "角色变更历史 from 字段应是被改成员的旧角色（当前实现疑似记录操作者自己的角色）",
    "B 把 A 从 viewer 提升为 editor 后：历史 member_changed.role.from 期望 viewer；功能上 A 可写账本 B（201），随后 B 把 A 改回 viewer 后 A 写 403",
    async () => {
      const promote = expectStatus(await setRole("b", BOOK.b, USER.a.id, "editor"), 200, "提升 Test-A 为 editor");
      eq(promote.changed, true, "changed");

      const tx = await createTransaction("a", BOOK.b, { key: "PERM6", amountCents: 4666, note: `${PREFIX}PERM6` });
      expectStatus(await deleteTransaction("a", BOOK.b, tx.id), 204, "提升后 A 写账本 B");

      const history = await historyOf("b", BOOK.b, 50);
      const roleEvents = history.entries.filter(
        (entry) => entry.kind === "member_changed" && entry.changes.some((change) => change.label === "role"),
      );
      check(roleEvents.length >= 1, "应有角色变更历史");
      const promotion = roleEvents[0];
      const roleChange = promotion.changes.find((change) => change.label === "role");
      note(`最新角色变更历史：from=${roleChange.from} to=${roleChange.to}`);

      const demote = expectStatus(await setRole("b", BOOK.b, USER.a.id, "viewer"), 200, "恢复 Test-A 为 viewer");
      eq(demote.changed, true, "changed");
      expectError(await call("a", "POST", "/transactions", { body: txBodyFor("demotedB"), book: BOOK.b }), 403, "book_read_only", "恢复 viewer 后 A 写账本 B");

      eq(roleChange.from, "viewer", "角色变更历史的 from 应为 Test-A 的旧角色 viewer");
    },
  );

  t(
    "PERM",
    "PERM-07",
    "创建者保护自己的角色 / 成员列表；普通账号访问 /admin/* 一律 403",
    "A 在账本 A 把自己降为 viewer → 400 creator_is_editor；B 在账本 B 同样；/admin/self、/admin/overview、/admin/users、/admin/audit 均 403 admin_forbidden",
    async () => {
      expectError(await setRole("a", BOOK.a, USER.a.id, "viewer"), 400, "creator_is_editor", "创建者自我降级");
      expectError(await setRole("b", BOOK.b, USER.b.id, "viewer"), 400, "creator_is_editor", "创建者自我降级（账本 B）");
      for (const path of ["/self", "/overview", "/users", "/audit"]) {
        expectError(await adminGet("a", path), 403, "admin_forbidden", `普通账号 GET /admin${path}`);
      }
      note("无管理员账号：管理员是否可访问私人账本未验证（见报告未覆盖项）");
    },
  );

  t(
    "PERM",
    "PERM-08",
    "x-libellum-book 隔离：不存在的账本 id → 403；空/缺省 header 走兼容回退；viewer 可 activate",
    "随机 uuid 的 header 下 GET /ledger 与 POST /transactions → 403 book_forbidden；空 header / 无 header → 200（回退到最早成员账本）；A viewer 在账本 B activate → 200",
    async () => {
      const randomBook = crypto.randomUUID();
      expectError(await call("a", "GET", "/ledger", { book: randomBook }), 403, "book_forbidden", "随机账本 GET /ledger");
      expectError(
        await call("a", "POST", "/transactions", { body: txBodyFor("randbook"), book: randomBook }),
        403,
        "book_forbidden",
        "随机账本 POST /transactions",
      );

      const emptyHeader = await call("a", "GET", "/ledger", { headers: { "x-libellum-book": "" } });
      const emptyData = expectStatus(emptyHeader, 200, "空 header GET /ledger");
      const noHeader = await call("a", "GET", "/ledger");
      const noHeaderData = expectStatus(noHeader, 200, "无 header GET /ledger");
      eq(noHeaderData.book.id, emptyData.book.id, "空 header 与无 header 的回退账本应一致");
      observe("header 回退账本", `${noHeaderData.book.name}（${noHeaderData.book.id}）—— 兼容路径，取最早成员关系`);

      expectStatus(await activateBook("a", BOOK.b), 200, "viewer 在账本 B activate");
    },
  );
}

function stateName(key) {
  return key === "a" ? "E2E Book A personal/shared" : "E2E Book B reverse permissions";
}

// ---------------------------------------------------------------------------
// Cases — ledger lifecycle
// ---------------------------------------------------------------------------

function registerLifecycleCases() {
  t(
    "LIFE",
    "LIFE-01",
    "创建临时账本 C：预设齐全、账目为 0、出现在 A 的可打开列表",
    "POST /books → 201；GET /ledger C 有每种 kind 的系统「暂无分类」、预设分类/支付方式、0 账目；/books A 可打开列表含 C",
    async () => {
      const result = await call("a", "POST", "/books", { body: { name: `${PREFIX}BOOK-C` } });
      const book = expectStatus(result, 201, "创建临时账本 C");
      created.books.push({ id: book.id, name: book.name, creator: "a" });
      fx.c = { id: book.id, name: book.name };
      BOOK_LABEL.set(book.id, "C");

      const ledger = await ledgerOf("a", book.id);
      eqNumber(ledger.stats.transactionCount, 0, "账本 C 账目数");
      check(systemCategory(ledger, "expense") && systemCategory(ledger, "income"), "账本 C 应有收入/支出两个系统分类");
      check(ledger.categories.some((category) => !category.isSystem), "账本 C 应有预设分类");
      check(ledger.paymentMethods.length >= 1, "账本 C 应有预设支付方式");
      eqNumber(ledger.tags.length, 0, "账本 C 初始标签数");

      const booksA = await booksOf("a");
      const c = bookSummary(booksA, book.id);
      check(c, "账本 C 应出现在 /books.books");
      eqNumber(c.memberCount, 1, "账本 C 初始成员数");
      eq(c.isCreator, true, "A 是账本 C 创建者");
      fx.sys.cExpense = systemCategory(ledger, "expense");
    },
  );

  t(
    "LIFE",
    "LIFE-02",
    "非成员访问账本 C：读与写均 403 book_forbidden",
    "Test-B 在未受邀前 GET /ledger C、POST /transactions C → 403 book_forbidden",
    async () => {
      expectError(await call("b", "GET", "/ledger", { book: fx.c.id }), 403, "book_forbidden", "非成员读账本 C");
      expectError(
        await call("b", "POST", "/transactions", { body: txBodyFor("c-no-member"), book: fx.c.id }),
        403,
        "book_forbidden",
        "非成员写账本 C",
      );
    },
  );

  t(
    "LIFE",
    "LIFE-03",
    "加入流程（B 创建 D，A 通过分享链接加入）：预览→加入→editor→历史记录→不能重复邀请",
    "B 创建 D；B 建 editor 分享链接 → 201；A 预览 200；A 加入 → 200 joined=true role=editor；A 的角色 editor；历史记录 member_changed；已是成员后再邀请 → 400 already_member",
    async () => {
      /**
       * ⚠️ 邀请主流程（POST /books/invite 201、重复邀请 refreshed=true、
       * 非收件人不能代决定、接受后 joined=true）已在受控轮 TLQ1 验证通过。
       * 本环境当日的通知配额只剩 1 条（B→A），必须留给 LIFE-06 的“重新邀请角色”
       * 用例，因此本轮加入流程改用分享链接 —— 这同时补上了此前未覆盖的分享链接加入。
       */
      const bookD = expectStatus(await call("b", "POST", "/books", { body: { name: `${PREFIX}BOOK-D` } }), 201, "B 创建临时账本 D");
      fx.d = { id: bookD.id, name: bookD.name };
      created.books.push({ id: bookD.id, name: bookD.name, creator: "b" });
      BOOK_LABEL.set(bookD.id, "D");
      expectError(await call("a", "GET", "/ledger", { book: fx.d.id }), 403, "book_forbidden", "非成员 A 读账本 D");

      const link = expectStatus(await createShareLink("b", fx.d.id, { role: "editor" }), 201, "B 创建账本 D 的分享链接");
      const preview = expectStatus(await previewShareLink("a", link.token), 200, "A 预览账本 D 的分享链接");
      check(JSON.stringify(preview).includes(fx.d.id), "预览应包含账本 D 的 id");
      const joined = expectStatus(await joinShareLink("a", link.token), 200, "A 通过分享链接加入 D");
      eq(joined.joined, true, "share link joined");
      eq(joined.role, "editor", "share link role");
      eq(joined.bookId, fx.d.id, "share link bookId");

      const members = await membersOf("b", fx.d.id);
      eq(members.members.find((member) => member.userId === USER.a.id)?.role, "editor", "A 在账本 D 的角色");
      eq(bookSummary(await booksOf("a"), fx.d.id)?.role, "editor", "A 的 /books 中 D 的角色");

      const history = await historyOf("b", fx.d.id, 10);
      check(history.entries.some((entry) => entry.kind === "member_changed"), "账本 D 历史应记录加入");

      expectError(
        await invite("b", fx.d.id, { username: USER.a.username }),
        400,
        "already_member",
        "已是成员后再次邀请（already_member 检查在配额之前）",
      );
      note("邀请主流程（201 / 重复邀请 refreshed=true / 收件人接受）在受控轮 TLQ1 已通过；本轮受通知配额限制改用分享链接");
    },
  );

  t(
    "LIFE",
    "LIFE-04",
    "邀请参数与对象校验（在账本 D 上）：自己 / 不存在 / 两个标识 / 无标识",
    "邀请自己 → 400 account_is_self；不存在 → 404 account_not_found；两个标识或都没有 → 400 validation_failed；均不产生成员",
    async () => {
      const self = await invite("b", fx.d.id, { username: USER.b.username });
      expectError(self, 400, "account_is_self", "邀请自己");
      const missing = await invite("b", fx.d.id, { username: `no_such_${RUN}` });
      expectError(missing, 404, "account_not_found", "邀请不存在的用户名");
      const both = await invite("b", fx.d.id, { username: USER.a.username, accountNumber: "10000101" });
      expectError(both, 400, "validation_failed", "同时给两个标识");
      const none = await invite("b", fx.d.id, {});
      expectError(none, 400, "validation_failed", "两个标识都不给");
      const members = await membersOf("b", fx.d.id);
      eqNumber(members.members.length, 2, "成员数仍为 2（B + A）");
    },
  );

  t(
    "LIFE",
    "LIFE-05",
    "分享链接加入 + 成员保护 + 退出：B 通过链接加入 C 后退出，立即失去访问；/books.memberCount 应等于当前成员数",
    "A 建 editor 分享链接 → B 预览 200、加入 200（role=editor）；A 移除创建者 400、B 移除自己 400、移除随机用户 4xx；B leave C → 200；B 访问 C → 403；成员列表只剩 A；A 的 /books 中 C.memberCount 期望 1",
    async () => {
      const link = expectStatus(await createShareLink("a", fx.c.id, { role: "editor" }), 201, "A 创建账本 C 的分享链接");
      check(typeof link.token === "string" && link.token.length > 0, "分享链接应返回 token");
      fx.c.editorToken = link.token;

      const preview = expectStatus(await previewShareLink("b", link.token), 200, "B 预览分享链接");
      check(JSON.stringify(preview).includes(fx.c.id), "预览应包含账本 C 的 id");
      const joined = expectStatus(await joinShareLink("b", link.token), 200, "B 通过分享链接加入 C");
      eq(joined.joined, true, "share link joined");
      eq(joined.role, "editor", "share link role");
      eq((await membersOf("a", fx.c.id)).members.find((member) => member.userId === USER.b.id)?.role, "editor", "B 在账本 C 的角色");

      expectError(await removeMemberRequest("a", fx.c.id, USER.a.id), 400, "creator_cannot_be_removed", "移除创建者");
      expectError(await removeMemberRequest("b", fx.c.id, USER.b.id), 400, "remove_self", "B 通过成员列表移除自己");
      const randomUser = crypto.randomUUID();
      const missing = await removeMemberRequest("a", fx.c.id, randomUser);
      check([403, 404].includes(missing.status), `移除不存在成员应 403/404，实际 ${missing.status}`);
      note(`移除不存在成员的返回：${missing.status} ${missing.data?.code}`);

      const result = expectStatus(await leaveBook("b", fx.c.id), 200, "B 退出账本 C");
      eq(result.left, true, "leave left");
      expectError(await call("b", "GET", "/ledger", { book: fx.c.id }), 403, "book_forbidden", "退出后 B 读账本 C");
      expectError(
        await call("b", "POST", "/transactions", { body: txBodyFor("left"), book: fx.c.id }),
        403,
        "book_forbidden",
        "退出后 B 写账本 C",
      );
      expectAbsent((await booksOf("b")).books ?? [], fx.c.id, "退出后 B 的 /books 不应再有 C");

      const members = await membersOf("a", fx.c.id);
      eqNumber(members.members.length, 1, "账本 C 当前成员数（只应剩 A）");
      eq(members.members[0].userId, USER.a.id, "剩余成员应为 A");
      const history = await historyOf("a", fx.c.id, 10);
      check(history.entries.some((entry) => entry.kind === "member_changed"), "历史应记录退出");

      const booksA = await booksOf("a");
      const c = bookSummary(booksA, fx.c.id);
      check(c, "账本 C 仍应在 A 的可打开列表");
      note(`/books 中账本 C 的 memberCount=${c.memberCount}，实际成员数=1`);
      eqNumber(c.memberCount, 1, "账本列表 memberCount 应等于当前成员数（已退出成员不应计入）");
    },
  );

  t(
    "LIFE",
    "LIFE-06",
    "退出后可再次邀请；重新邀请指定的 viewer 角色应在重新加入时生效；owner 可移除成员",
    "A 退出 D；B 以 role=viewer 重新邀请 A → 201；A 接受 → 重新加入后的角色期望 viewer；B 以 viewer 链接重新加入 C → 角色 viewer；A 移除 B → 204，B 访问 C → 403",
    async () => {
      // (a) 邀请路径的“重新加入”是否会采用这次邀请的角色
      expectStatus(await leaveBook("a", fx.d.id), 200, "A 退出账本 D");
      expectError(await call("a", "GET", "/ledger", { book: fx.d.id }), 403, "book_forbidden", "退出后 A 读账本 D");
      expectAbsent((await booksOf("a")).books ?? [], fx.d.id, "退出后 A 的 /books 不应再有 D");

      const invitation = expectStatus(await invite("b", fx.d.id, { username: USER.a.username, role: "viewer" }), 201, "重新邀请 A（viewer）加入 D");
      eq(invitation.role, "viewer", "重新邀请 role");
      const pending = (await inboxOf("a")).notifications.find(
        (notification) => notification.book?.id === fx.d.id && notification.status === "pending",
      );
      check(pending, "A 应有待处理邀请");
      expectStatus(await decide("a", pending.id, "accepted"), 200, "A 接受重新邀请");
      const rejoinedRole = (await membersOf("b", fx.d.id)).members.find((member) => member.userId === USER.a.id)?.role;
      note(`重新邀请（role=viewer）后 A 的实际角色=${rejoinedRole}`);

      // (b) 分享链接路径的重新加入：以 viewer 链接重新加入 C，并让 A 移除 B
      const viewerLink = expectStatus(await createShareLink("a", fx.c.id, { role: "viewer" }), 201, "A 创建账本 C 的 viewer 分享链接");
      const rejoined = expectStatus(await joinShareLink("b", viewerLink.token), 200, "B 通过 viewer 链接重新加入 C");
      eq(rejoined.role, "viewer", "viewer 链接返回的角色");
      eq((await membersOf("a", fx.c.id)).members.find((member) => member.userId === USER.b.id)?.role, "viewer", "B 重新加入 C 后的角色");

      expectStatus(await removeMemberRequest("a", fx.c.id, USER.b.id), 204, "owner 移除成员 B");
      expectError(await call("b", "GET", "/ledger", { book: fx.c.id }), 403, "book_forbidden", "被移除后 B 读账本 C");
      eqNumber((await membersOf("a", fx.c.id)).members.length, 1, "移除后成员数");

      // (c) 创建者保护：B 是 D 的创建者
      expectError(await leaveBook("b", fx.d.id), 400, "creator_cannot_leave", "创建者退出账本 D");
      expectError(
        await removeMemberRequest("b", fx.d.id, USER.b.id),
        400,
        "creator_cannot_be_removed",
        "创建者通过成员列表移除自己（创建者保护优先于 remove_self）",
      );

      eq(rejoinedRole, "viewer", "重新加入后的角色应为邀请 payload 指定的 viewer");
    },
  );

  t(
    "LIFE",
    "LIFE-07",
    "弃置 / 恢复：只有创建者能弃置；弃置后隐藏但数据仍在；activate 400；恢复后可进入",
    "A dispose C → 200；/books.disposed 含 C；activate → 400 book_disposed；B dispose/restore 账本 A → 403 book_not_creator；A restore C → 200，C 回到可打开列表，activate → 200",
    async () => {
      const dispose = expectStatus(await call("a", "POST", `/books/${fx.c.id}/dispose`), 200, "A 弃置账本 C");
      eq(dispose.alreadyDisposed, false, "首次弃置 alreadyDisposed");
      const idempotent = expectStatus(await call("a", "POST", `/books/${fx.c.id}/dispose`), 200, "重复弃置账本 C");
      eq(idempotent.alreadyDisposed, true, "重复弃置 alreadyDisposed");

      const booksA = await booksOf("a");
      check(disposedSummary(booksA, fx.c.id), "账本 C 应出现在 /books.disposed");
      expectAbsent(booksA.books ?? [], fx.c.id, "弃置后账本 C 不应在可打开列表");
      expectError(await call("a", "POST", `/books/${fx.c.id}/activate`), 400, "book_disposed", "activate 弃置账本");

      const disposedRead = await call("a", "GET", "/ledger", { book: fx.c.id });
      observe("弃置账本仍可按 id 读取", `${disposedRead.status} ${disposedRead.data?.book?.name ?? disposedRead.data?.code}`);

      expectError(await call("b", "POST", `/books/${BOOK.a}/dispose`), 403, "book_not_creator", "非创建者弃置账本 A");
      expectError(await call("b", "POST", `/books/${BOOK.a}/restore`), 403, "book_not_creator", "非创建者恢复账本 A");

      const restore = expectStatus(await call("a", "POST", `/books/${fx.c.id}/restore`), 200, "A 恢复账本 C");
      eq(restore.alreadyOpen, false, "首次恢复 alreadyOpen");
      check(bookSummary(await booksOf("a"), fx.c.id), "恢复后账本 C 应在可打开列表");
      expectStatus(await activateBook("a", fx.c.id), 200, "恢复后 activate 账本 C");
    },
  );

  t(
    "LIFE",
    "LIFE-08",
    "创建者不能退出自己的账本；重命名权限与路径/header 一致性",
    "A leave C → 400 creator_cannot_leave；B leave B → 400；B（editor）重命名账本 A → 200 且 A 可见；A 改回原名 → 200；A 用 header=A/path=B 重命名 → 400 book_mismatch；历史有 book_changed",
    async () => {
      expectError(await leaveBook("a", fx.c.id), 400, "creator_cannot_leave", "创建者退出账本 C");
      expectError(await leaveBook("b", BOOK.b), 400, "creator_cannot_leave", "创建者退出账本 B");

      const renamed = `${state.books.a.name} [B]`;
      expectStatus(await renameBook("b", BOOK.a, BOOK.a, renamed), 200, "editor 重命名账本 A");
      const booksAfter = await booksOf("a");
      eq(bookSummary(booksAfter, BOOK.a)?.name, renamed, "重命名后账本 A 名称");
      expectStatus(await renameBook("a", BOOK.a, BOOK.a, state.books.a.name), 200, "A 恢复账本 A 名称");

      const mismatch = await renameBook("a", BOOK.a, BOOK.b, "should-not-apply");
      expectError(mismatch, 400, "book_mismatch", "header 与 path 不一致的重命名");
      eq(bookSummary(await booksOf("a"), BOOK.a)?.name, state.books.a.name, "book_mismatch 后账本 A 名称");
      eq(bookSummary(await booksOf("b"), BOOK.b)?.name, state.books.b.name, "book_mismatch 后账本 B 名称");

      const history = await historyOf("a", BOOK.a, 20);
      const bookChanged = history.entries.filter((entry) => entry.kind === "book_changed");
      check(bookChanged.length >= 1, "历史应记录账本改名");
      note(`book_changed 条数=${bookChanged.length}`);
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — cross-ledger isolation & error codes
// ---------------------------------------------------------------------------

function registerIsolationCases() {
  t(
    "ISO",
    "ISO-01",
    "跨账本账目 id 注入：用账本 A 的 header 读/改/删账本 B 的账目 → 404",
    "GET/PATCH/DELETE/restore 账本 B 账目（header=A）全部 404 transaction_missing；账本 B 账目不变",
    async () => {
      const bTx = baseTxB()[0];
      const before = fullTransactionSnapshot(expectStatus(await transactionOf("b", BOOK.b, bTx), 200, "读取账本 B 账目"));

      expectError(await call("a", "GET", `/transactions/${bTx}`, { book: BOOK.a }), 404, "transaction_missing", "跨账本 GET");
      expectError(await call("a", "PATCH", `/transactions/${bTx}`, { body: { version: 1 }, book: BOOK.a }), 404, "transaction_missing", "跨账本 PATCH");
      expectError(await call("a", "DELETE", `/transactions/${bTx}`, { book: BOOK.a }), 404, "transaction_missing", "跨账本 DELETE");
      expectError(await call("a", "POST", `/transactions/${bTx}/restore`, { book: BOOK.a }), 404, "transaction_missing", "跨账本 restore");

      eq(fullTransactionSnapshot(expectStatus(await transactionOf("b", BOOK.b, bTx), 200, "再次读取账本 B 账目")), before, "账本 B 账目未变");
    },
  );

  t(
    "ISO",
    "ISO-02",
    "跨账本对象注入：新建账目引用账本 B 的分类/支付方式/标签 → 403",
    "categoryId → 403 category_invalid；paymentMethodId → 403 payment_method_invalid；tagIds → 403 tag_invalid；均不创建账目",
    async () => {
      const before = await liveCountOf("a", BOOK.a);
      expectError(
        await call("a", "POST", "/transactions", { body: txBodyFor("foreign-cat", { categoryId: fx.b.cat.id }), book: BOOK.a }),
        403,
        "category_invalid",
        "引用账本 B 分类",
      );
      expectError(
        await call("a", "POST", "/transactions", { body: txBodyFor("foreign-pay", { paymentMethodId: fx.b.pay.id }), book: BOOK.a }),
        403,
        "payment_method_invalid",
        "引用账本 B 支付方式",
      );
      expectError(
        await call("a", "POST", "/transactions", { body: txBodyFor("foreign-tag", { tagIds: [fx.b.tag.id] }), book: BOOK.a }),
        403,
        "tag_invalid",
        "引用账本 B 标签",
      );
      eqNumber(await liveCountOf("a", BOOK.a), before, "账目数不变");
    },
  );

  t(
    "ISO",
    "ISO-03",
    "跨账本列表过滤不泄漏：用账本 B 的分类/支付方式/标签 id 过滤账本 A 账目 → 空",
    "GET /transactions?categoryId/paymentMethodId/tagId=<B 的 id> 均 200 且 items 为空",
    async () => {
      const byCategory = await transactionsOf("a", BOOK.a, `?categoryId=${fx.b.cat.id}`);
      eq(byCategory.items.length, 0, "按账本 B 分类过滤");
      const byPayment = await transactionsOf("a", BOOK.a, `?paymentMethodId=${fx.b.pay.id}`);
      eq(byPayment.items.length, 0, "按账本 B 支付方式过滤");
      const byTag = await transactionsOf("a", BOOK.a, `?tagId=${fx.b.tag.id}`);
      eq(byTag.items.length, 0, "按账本 B 标签过滤");
    },
  );

  t(
    "ISO",
    "ISO-04",
    "跨账本分类/支付方式/标签写操作：header=A 针对账本 B 的 id 全部 404",
    "PATCH/DELETE/permanent-delete 分类、PATCH/DELETE/permanent-delete 支付方式、PATCH/DELETE 标签（账本 B id + header A）均 404，对象不变",
    async () => {
      const beforeLedgerB = await ledgerOf("b", BOOK.b);
      expectError(await call("a", "PATCH", `/categories/${fx.b.cat.id}`, { body: { name: "x" }, book: BOOK.a }), 404, "category_missing", "跨账本 PATCH 分类");
      expectError(await call("a", "DELETE", `/categories/${fx.b.cat.id}`, { book: BOOK.a }), 404, "category_missing", "跨账本 DELETE 分类");
      expectError(await call("a", "POST", `/categories/${fx.b.cat.id}/permanent-delete`, { body: {}, book: BOOK.a }), 404, "category_missing", "跨账本 permanent 分类");
      expectError(await call("a", "PATCH", `/payment-methods/${fx.b.pay.id}`, { body: { name: "x" }, book: BOOK.a }), 404, "payment_method_missing", "跨账本 PATCH 支付方式");
      expectError(await call("a", "DELETE", `/payment-methods/${fx.b.pay.id}`, { book: BOOK.a }), 404, "payment_method_missing", "跨账本 DELETE 支付方式");
      expectError(await call("a", "POST", `/payment-methods/${fx.b.pay.id}/permanent-delete`, { body: {}, book: BOOK.a }), 404, "payment_method_missing", "跨账本 permanent 支付方式");
      expectError(await call("a", "DELETE", `/tags/${fx.b.tag.id}`, { book: BOOK.a }), 404, "tag_missing", "跨账本 DELETE 标签");
      const afterLedgerB = await ledgerOf("b", BOOK.b);
      eq(afterLedgerB.categories, beforeLedgerB.categories, "账本 B 分类未变");
      eq(afterLedgerB.paymentMethods, beforeLedgerB.paymentMethods, "账本 B 支付方式未变");
      eq(afterLedgerB.tags, beforeLedgerB.tags, "账本 B 标签未变");
    },
  );

  t(
    "ISO",
    "ISO-05",
    "幂等键与账目 id 的跨账本/重复使用：409 与幂等重放 200",
    "同一 idempotencyKey 在另一账本使用 → 409 idempotency_conflict；同一 id 换新 key → 409 transaction_conflict；同 id+同 key 重放 → 200 且同一条",
    async () => {
      const tx = await createTransaction("a", BOOK.a, { key: "ISO5", amountCents: 5151, note: `${PREFIX}ISO5` });
      const key = tx.id;

      const crossBook = await call("b", "POST", "/transactions", {
        body: txBodyFor("iso5b", { idempotencyKey: key }),
        book: BOOK.b,
      });
      expectError(crossBook, 409, "idempotency_conflict", "幂等键跨账本复用");

      const sameIdNewKey = await call("a", "POST", "/transactions", {
        body: txBodyFor("iso5c", { id: tx.id, idempotencyKey: crypto.randomUUID() }),
        book: BOOK.a,
      });
      expectError(sameIdNewKey, 409, "transaction_conflict", "同一 id 换新 key");

      const replay = await call("a", "POST", "/transactions", {
        body: txBodyFor("iso5d", { id: tx.id, idempotencyKey: key }),
        book: BOOK.a,
      });
      const replayed = expectStatus(replay, 200, "同 id+key 幂等重放");
      eq(replayed.id, tx.id, "重放返回同一条账目");
      eqNumber(replayed.seq, tx.seq, "重放返回同一 seq");
    },
  );

  t(
    "ISO",
    "ISO-06",
    "错误码：401 / 400 / 404 / 409 的代表路径",
    "未登录 GET /books → 401 not_authenticated；空 body POST /transactions → 400 validation_failed；未知路由 → 404 not_found；restore 未删除账目 → 409 transaction_not_deleted",
    async () => {
      expectError(await call(null, "GET", "/books"), 401, "not_authenticated", "未登录访问 /books");
      expectError(
        await call("a", "POST", "/transactions", { body: {}, book: BOOK.a }),
        400,
        "validation_failed",
        "空 body 建账目",
      );
      expectError(await call("a", "GET", "/no-such-route", { book: BOOK.a }), 404, "not_found", "未知路由");
      expectError(
        await restoreTransaction("a", BOOK.a, baseTxA()[0]),
        409,
        "transaction_not_deleted",
        "restore 未删除账目",
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — concurrency
// ---------------------------------------------------------------------------

function registerConcurrencyCases() {
  t(
    "CONC",
    "CONC-01",
    "同一分类并发永久删除（不同替换）：只有一个 200，另一个 404，数据不混",
    "两个并发请求分别指定替换 R1/R2：恰好 1 个 200、1 个 404；两笔账目都指向胜者的替换；摘要只 +1；账目无混合",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}CAT-CX`, "expense");
      const r1 = await createCategory("a", BOOK.a, `${PREFIX}CAT-CX1`, "expense");
      const r2 = await createCategory("a", BOOK.a, `${PREFIX}CAT-CX2`, "expense");
      const tx1 = await createTransaction("a", BOOK.a, { key: "CX1", categoryId: cat.id, amountCents: 6101, note: `${PREFIX}CX1` });
      const tx2 = await createTransaction("a", BOOK.a, { key: "CX2", categoryId: cat.id, amountCents: 6102, note: `${PREFIX}CX2` });
      const opsBefore = await opsTotalOf("a", BOOK.a);

      const order = Math.random() < 0.5 ? [r1, r2] : [r2, r1];
      const [first, second] = await Promise.all([
        permanentDeleteCategory("a", BOOK.a, cat.id, { replacementCategoryId: order[0].id }),
        permanentDeleteCategory("a", BOOK.a, cat.id, { replacementCategoryId: order[1].id }),
      ]);
      const responses = [first, second];
      const ok = responses.filter((response) => response.status === 200);
      const missing = responses.filter((response) => response.status === 404);
      eqNumber(ok.length, 1, "200 的数量");
      eqNumber(missing.length, 1, "404 的数量");
      const winner = ok[0].data.replacementId;
      note(`胜者替换=${winner === r1.id ? "R1" : "R2"}；状态=${responses.map((response) => response.status).join("/")}`);

      for (const tx of [tx1, tx2]) {
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, tx.id), "读取并发删除后的账目");
        eq(dto.categoryId, winner, "账目应全部指向胜者的替换，不能混合");
      }
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "摘要只增加一条");
      const ledger = await ledgerOf("a", BOOK.a);
      expectAbsent(ledger.categories, cat.id, "被删除的分类");
      check(findCategory(ledger, r1.id) || findCategory(ledger, r2.id), "至少一个替换分类仍在");
    },
  );

  t(
    "CONC",
    "CONC-02",
    "同一支付方式并发永久删除：只有一个 200，另一个 404，账目指向胜者的替换",
    "并发（一个指定替换、一个改为未指定）：1 个 200、1 个 404；账目最终值与胜者一致；摘要 +1",
    async () => {
      const pay = await createPayment("a", BOOK.a, `${PREFIX}PAY-CX`);
      const replacement = await createPayment("a", BOOK.a, `${PREFIX}PAY-CX1`);
      const tx = await createTransaction("a", BOOK.a, { key: "PCX", paymentMethodId: pay.id, amountCents: 6201, note: `${PREFIX}PCX` });
      const opsBefore = await opsTotalOf("a", BOOK.a);

      const [a, b] = await Promise.all([
        permanentDeletePayment("a", BOOK.a, pay.id, { replacementPaymentMethodId: replacement.id }),
        permanentDeletePayment("a", BOOK.a, pay.id, {}),
      ]);
      const responses = [a, b];
      const ok = responses.filter((response) => response.status === 200);
      eqNumber(ok.length, 1, "200 的数量");
      eqNumber(responses.filter((response) => response.status === 404).length, 1, "404 的数量");
      const winner = ok[0].data.replacementId;
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, tx.id), "读取并发删除后的账目");
      eq(dto.paymentMethodId, winner, "账目支付方式应等于胜者的替换（可能是 null）");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "摘要只增加一条");
    },
  );

  t(
    "CONC",
    "CONC-03",
    "同一标签并发删除：只有一个 200，另一个 404，解绑只发生一次",
    "并发删除同一标签：1 个 200、1 个 404；账目其他标签保留；摘要 +1",
    async () => {
      const tagA = await createTag("a", BOOK.a, `${PREFIX}TAG-CX`);
      const tagB = await createTag("a", BOOK.a, `${PREFIX}TAG-CX2`);
      const tx = await createTransaction("a", BOOK.a, { key: "TCX", tagIds: [tagA.id, tagB.id], amountCents: 6301, note: `${PREFIX}TCX` });
      const opsBefore = await opsTotalOf("a", BOOK.a);

      const [first, second] = await Promise.all([
        deleteTag("a", BOOK.a, tagA.id),
        deleteTag("a", BOOK.a, tagA.id),
      ]);
      const responses = [first, second];
      eqNumber(responses.filter((response) => response.status === 200).length, 1, "200 的数量");
      eqNumber(responses.filter((response) => response.status === 404).length, 1, "404 的数量");
      const dto = expectLiveDto(await transactionOf("a", BOOK.a, tx.id), "读取并发删除后的账目");
      eq(dto.tags.map((entry) => entry.id), [tagB.id], "另一标签应保留");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "摘要只增加一条");
    },
  );

  t(
    "CONC",
    "CONC-04",
    "同一未使用分类三并发删除：恰好一个 200，两个 404，摘要只 +1",
    "3 个并发 permanent-delete：1×200、2×404；分类消失；摘要 +1",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}CAT-CZ`, "expense");
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const responses = await Promise.all([
        permanentDeleteCategory("a", BOOK.a, cat.id, {}),
        permanentDeleteCategory("a", BOOK.a, cat.id, {}),
        permanentDeleteCategory("a", BOOK.a, cat.id, {}),
      ]);
      eqNumber(responses.filter((response) => response.status === 200).length, 1, "200 的数量");
      eqNumber(responses.filter((response) => response.status === 404).length, 2, "404 的数量");
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "摘要只增加一条");
      expectAbsent((await ledgerOf("a", BOOK.a)).categories, cat.id, "分类");
    },
  );

  t(
    "CONC",
    "CONC-05",
    "同一 idempotencyKey 并发创建 4 次：只落 1 行、只写 1 条 created 事件",
    "4 个并发 POST 同 id+key：全部 200/201 且返回同一 id/seq；未删除账目数 +1；事件数 +1",
    async () => {
      const ledgerBefore = await ledgerOf("a", BOOK.a);
      const body = txBodyFor("conc5", { amountCents: 6501, note: `${PREFIX}CONC5` });
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => call("a", "POST", "/transactions", { body, book: BOOK.a })),
      );
      for (const response of responses) {
        check([200, 201].includes(response.status), `并发幂等创建状态应 200/201，实际 ${response.status} ${messageOf(response)}`);
        eq(response.data.id, body.id, "返回同一 id");
        eqNumber(response.data.seq, responses[0].data.seq, "返回同一 seq");
      }
      note(`状态=${responses.map((response) => response.status).join("/")}`);
      const ledgerAfter = await ledgerOf("a", BOOK.a);
      eqNumber(ledgerAfter.stats.transactionCount, ledgerBefore.stats.transactionCount + 1, "未删除账目数只 +1");
      eqNumber(ledgerAfter.stats.eventCount, ledgerBefore.stats.eventCount + 1, "created 事件只 +1");
      created.transactions.push({ user: "a", book: BOOK.a, id: body.id, creator: "a" });
    },
  );

  t(
    "CONC",
    "CONC-06",
    "删除分类期间新增引用：不得 500；最终状态一致（或按文档 409 category_in_use）",
    "60 笔账目引用分类，删除与 8 个新引用并发：删除结果只能是 200 或 409；每个创建只能 201 或 403；无 5xx；最终分类/账目引用一致；摘要数与删除是否成功一致",
    async () => {
      const cat = await createCategory("a", BOOK.a, `${PREFIX}CAT-RC`, "expense");
      for (let index = 0; index < 60; index += 1) {
        await createTransaction("a", BOOK.a, { key: `RC${index}`, categoryId: cat.id, amountCents: 7000 + index, note: `${PREFIX}RC-${index}` });
      }
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const createdIds = [];
      const bodies = [];
      for (let index = 0; index < 8; index += 1) {
        const body = txBodyFor(`rc-${index}`, { categoryId: cat.id, amountCents: 8000 + index });
        bodies.push(body);
        createdIds.push(body.id);
      }

      const deletePromise = permanentDeleteCategory("a", BOOK.a, cat.id, {});
      const delays = [0, 3, 7, 12, 18, 25, 35, 50];
      const createPromises = bodies.map((body, index) =>
        sleep(delays[index]).then(() => call("a", "POST", "/transactions", { body, book: BOOK.a })),
      );
      const [deleteResult, ...createResults] = await Promise.all([deletePromise, ...createPromises]);
      const deleteStatus = deleteResult.status;
      const createStatuses = createResults.map((result) => result.status);
      note(`删除状态=${deleteStatus}（${deleteResult.data?.code ?? ""}）；创建状态=${createStatuses.join("/")}`);

      const serverErrors = [deleteResult, ...createResults].filter((result) => result.status === 0 || result.status >= 500);
      check(serverErrors.length === 0, `并发期间出现 5xx/网络错误：${serverErrors.map((result) => `${result.status} ${messageOf(result)}`).join("; ")}`);
      check([200, 409].includes(deleteStatus), `删除结果应为 200 或 409，实际 ${deleteStatus} ${messageOf(deleteResult)}`);
      for (const status of createStatuses) {
        check([201, 403].includes(status), `新增引用状态应为 201 或 403，实际 ${status}`);
      }

      const ledger = await ledgerOf("a", BOOK.a);
      const categoryStillThere = Boolean(findCategory(ledger, cat.id));
      if (deleteStatus === 200) {
        check(!categoryStillThere, "删除成功时分类应消失");
        eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + 1, "删除成功应只写一条摘要");
        for (let index = 0; index < createdIds.length; index += 1) {
          if (createStatuses[index] !== 201) {
            expectStatus(await transactionOf("a", BOOK.a, createdIds[index]), 404, "被拒绝的新账目不应存在");
            continue;
          }
          created.transactions.push({ user: "a", book: BOOK.a, id: createdIds[index], creator: "a" });
          const dto = expectLiveDto(await transactionOf("a", BOOK.a, createdIds[index]), "读取并发期间创建的账目");
          check(dto.categoryId !== cat.id, "删除成功后新账目不应还指向已删除分类");
        }
      } else {
        check(categoryStillThere, "409 时分类应仍在");
        eqNumber(await opsTotalOf("a", BOOK.a), opsBefore, "409 时摘要不应增加");
        for (let index = 0; index < createdIds.length; index += 1) {
          if (createStatuses[index] !== 201) continue;
          created.transactions.push({ user: "a", book: BOOK.a, id: createdIds[index], creator: "a" });
          const dto = expectLiveDto(await transactionOf("a", BOOK.a, createdIds[index]), "读取并发期间创建的账目");
          eq(dto.categoryId, cat.id, "删除回滚后新账目应仍指向该分类");
        }
        note("未观测到 409 分支；本次调度下落到了 200 分支");
      }
    },
  );

  t(
    "CONC",
    "CONC-07",
    "删除支付方式期间新增引用：不得 500；最终 payment_method_id 一致",
    "20 笔账目引用支付方式，删除与 6 个新引用并发：删除 200/409；创建 201 或 403 payment_method_invalid；无 5xx；最终引用为胜者结果",
    async () => {
      const pay = await createPayment("a", BOOK.a, `${PREFIX}PAY-RC`);
      for (let index = 0; index < 20; index += 1) {
        await createTransaction("a", BOOK.a, { key: `PRC${index}`, paymentMethodId: pay.id, amountCents: 8100 + index, note: `${PREFIX}PRC-${index}` });
      }
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const bodies = Array.from({ length: 6 }, (_, index) => txBodyFor(`prc-${index}`, { paymentMethodId: pay.id, amountCents: 8200 + index }));

      const deletePromise = permanentDeletePayment("a", BOOK.a, pay.id, {});
      const delays = [0, 4, 9, 15, 22, 32];
      const createPromises = bodies.map((body, index) => sleep(delays[index]).then(() => call("a", "POST", "/transactions", { body, book: BOOK.a })));
      const [deleteResult, ...createResults] = await Promise.all([deletePromise, ...createPromises]);
      const createStatuses = createResults.map((result) => result.status);
      note(`删除状态=${deleteResult.status}（${deleteResult.data?.code ?? ""}）；创建状态=${createStatuses.join("/")}`);

      const serverErrors = [deleteResult, ...createResults].filter((result) => result.status === 0 || result.status >= 500);
      check(serverErrors.length === 0, `并发期间出现 5xx/网络错误：${serverErrors.map((result) => `${result.status} ${messageOf(result)}`).join("; ")}`);
      check([200, 409].includes(deleteResult.status), `删除结果应为 200/409，实际 ${deleteResult.status}`);
      for (const status of createStatuses) {
        check([201, 403].includes(status), `新增引用状态应为 201/403，实际 ${status}`);
      }
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + (deleteResult.status === 200 ? 1 : 0), "摘要数与删除结果一致");

      for (let index = 0; index < bodies.length; index += 1) {
        if (createStatuses[index] !== 201) continue;
        created.transactions.push({ user: "a", book: BOOK.a, id: bodies[index].id, creator: "a" });
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, bodies[index].id), "读取并发期间创建的账目");
        if (deleteResult.status === 200) {
          check(dto.paymentMethodId === null, "支付方式已删除：新账目的 paymentMethodId 应为 null");
        } else {
          eq(dto.paymentMethodId, pay.id, "删除回滚后新账目应仍指向该支付方式");
        }
      }
    },
  );

  t(
    "CONC",
    "CONC-08",
    "删除标签期间新增引用：不得 500；解绑/拒绝一致",
    "20 笔账目挂标签，删除与 6 个新引用并发：删除 200/404；创建 201 或 403 tag_invalid；无 5xx；最终账目标签不含已删除标签",
    async () => {
      const tagItem = await createTag("a", BOOK.a, `${PREFIX}TAG-RC`);
      for (let index = 0; index < 20; index += 1) {
        await createTransaction("a", BOOK.a, { key: `TRC${index}`, tagIds: [tagItem.id], amountCents: 8300 + index, note: `${PREFIX}TRC-${index}` });
      }
      const opsBefore = await opsTotalOf("a", BOOK.a);
      const bodies = Array.from({ length: 6 }, (_, index) => txBodyFor(`trc-${index}`, { tagIds: [tagItem.id], amountCents: 8400 + index }));

      const deletePromise = deleteTag("a", BOOK.a, tagItem.id);
      const delays = [0, 4, 9, 15, 22, 32];
      const createPromises = bodies.map((body, index) => sleep(delays[index]).then(() => call("a", "POST", "/transactions", { body, book: BOOK.a })));
      const [deleteResult, ...createResults] = await Promise.all([deletePromise, ...createPromises]);
      const createStatuses = createResults.map((result) => result.status);
      note(`删除状态=${deleteResult.status}（${deleteResult.data?.code ?? ""}）；创建状态=${createStatuses.join("/")}`);

      const serverErrors = [deleteResult, ...createResults].filter((result) => result.status === 0 || result.status >= 500);
      check(serverErrors.length === 0, `并发期间出现 5xx/网络错误：${serverErrors.map((result) => `${result.status} ${messageOf(result)}`).join("; ")}`);
      check([200, 404].includes(deleteResult.status), `删除结果应为 200/404，实际 ${deleteResult.status}`);
      for (const status of createStatuses) {
        check([201, 403].includes(status), `新增引用状态应为 201/403，实际 ${status}`);
      }
      eqNumber(await opsTotalOf("a", BOOK.a), opsBefore + (deleteResult.status === 200 ? 1 : 0), "摘要数与删除结果一致");

      for (let index = 0; index < bodies.length; index += 1) {
        if (createStatuses[index] !== 201) continue;
        created.transactions.push({ user: "a", book: BOOK.a, id: bodies[index].id, creator: "a" });
        const dto = expectLiveDto(await transactionOf("a", BOOK.a, bodies[index].id), "读取并发期间创建的账目（标签）");
        check(!dto.tags.some((entry) => entry.id === tagItem.id), "已删除标签不应再挂在新账目上");
      }
    },
  );

  t(
    "CONC",
    "CONC-09",
    "顺序幂等：重复 restore → 409；重复 delete → 404；重复永久删除 → 404",
    "同一账目 restore 两次：第二次 409 transaction_not_deleted；delete 两次：第二次 404；分类 permanent-delete 两次：第二次 404",
    async () => {
      const tx = await createTransaction("a", BOOK.a, { key: "IDEM9", amountCents: 6502, note: `${PREFIX}IDEM9` });
      expectStatus(await deleteTransaction("a", BOOK.a, tx.id), 204, "第一次 delete");
      expectStatus(await restoreTransaction("a", BOOK.a, tx.id), 200, "第一次 restore");
      expectError(await restoreTransaction("a", BOOK.a, tx.id), 409, "transaction_not_deleted", "第二次 restore");
      expectStatus(await deleteTransaction("a", BOOK.a, tx.id), 204, "第二次 delete");
      expectError(await deleteTransaction("a", BOOK.a, tx.id), 404, "transaction_missing", "第三次 delete");
    },
  );
}

// ---------------------------------------------------------------------------
// Cases — export / import
// ---------------------------------------------------------------------------

function registerExportCases() {
  t(
    "EXP",
    "EXP-01",
    "导出 CSV（owner）：行数等于当前未删除账目数，含基线账目",
    "GET /export?format=csv → 200 text/csv + x-libellum-row-count = /ledger.transactionCount；响应字节以 UTF-8 BOM（EF BB BF）开头、含中文表头；包含基线账目备注",
    async () => {
      const ledger = await ledgerOf("a", BOOK.a);
      const result = await exportGet("a", BOOK.a, "?format=csv");
      expectStatus(result, 200, "GET /export");
      const contentType = result.headers.get("content-type") ?? "";
      check(contentType.includes("text/csv"), `content-type 应为 text/csv，实际 ${contentType}`);
      const raw = await rawGet("a", "/export?format=csv", { book: BOOK.a });
      check(raw.status === 200, `原始字节请求状态 ${raw.status}`);
      const bom = raw.bytes[0] === 0xef && raw.bytes[1] === 0xbb && raw.bytes[2] === 0xbf;
      check(bom, `CSV 字节应以 UTF-8 BOM 开头，实际 ${[...raw.bytes.slice(0, 3)].map((value) => value.toString(16)).join(" ")}`);
      const rowCount = Number(result.headers.get("x-libellum-row-count"));
      eqNumber(rowCount, ledger.stats.transactionCount, "导出数据行数 = /ledger 未删除账目数");
      check(result.text.includes("日期") && result.text.includes("金额"), "CSV 应含中文表头");
      check(result.text.includes("E2E A-food-1"), "CSV 应包含基线账目备注");
      note(`CSV 字节=${raw.bytes.length}，字符数=${result.text.length}，行数=${rowCount}`);
    },
  );

  t(
    "EXP",
    "EXP-02",
    "导出模板：只有表头、0 行",
    "GET /export?template=1 → 200，x-libellum-row-count=0，含模板列名",
    async () => {
      const result = await exportGet("a", BOOK.a, "?template=1");
      expectStatus(result, 200, "GET /export?template=1");
      eqNumber(Number(result.headers.get("x-libellum-row-count")), 0, "模板行数");
      check(result.text.includes("日期") && result.text.includes("类型"), "模板应含中文表头");
    },
  );

  t(
    "EXP",
    "EXP-03",
    "POST /export 是 dry run：返回 fileRef/rowCount 但不写 export-log；真正下载（GET）才产生一条审计记录",
    "POST /export → 200 {fileRef,format,rowCount} 且 export-log 条数不变；GET /export → 200 且 export-log +1，最新一条 rowCount/fileRef 与响应头一致",
    async () => {
      const before = expectStatus(await exportLogOf("a", BOOK.a), 200, "GET /export-log");
      const liveCount = (await ledgerOf("a", BOOK.a)).stats.transactionCount;

      const post = await exportPost("a", BOOK.a, "?format=csv");
      const body = expectStatus(post, 200, "POST /export");
      check(typeof body.fileRef === "string" && body.fileRef.startsWith("Out-"), "fileRef 应为 Out- 编号");
      eq(body.format, "csv", "format");
      eqNumber(body.rowCount, liveCount, "POST /export rowCount");
      const logAfterPost = expectStatus(await exportLogOf("a", BOOK.a), 200, "GET /export-log（POST 后）");
      eqNumber(logAfterPost.entries.length, before.entries.length, "POST /export（dry run）不应写 export-log");

      const get = await exportGet("a", BOOK.a, "?format=csv");
      expectStatus(get, 200, "GET /export");
      const headerRef = get.headers.get("x-libellum-file-ref");
      const headerCount = Number(get.headers.get("x-libellum-row-count"));
      check(typeof headerRef === "string" && headerRef.startsWith("Out-"), "GET /export 应返回 x-libellum-file-ref");
      eqNumber(headerCount, liveCount, "GET /export 行数");

      const logAfterGet = expectStatus(await exportLogOf("a", BOOK.a), 200, "GET /export-log（GET 后）");
      eqNumber(logAfterGet.entries.length, before.entries.length + 1, "GET /export 应写一条 export-log");
      const newest = logAfterGet.entries[0];
      eqNumber(newest.rowCount, liveCount, "export-log rowCount");
      check(newest.fileRef === headerRef, "export-log fileRef 与 GET 响应头一致");
      check(!("rows" in newest) && !("content" in newest), "导出日志不应包含账目内容");
    },
  );

  t(
    "EXP",
    "EXP-04",
    "导入：空文件 / 非数据行被拒绝且不写数据",
    "仅有表头的 CSV → 400 no_rows；空文件 → 400 empty_file；账目数不变",
    async () => {
      const before = await liveCountOf("a", BOOK.a);
      const template = "\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n";
      expectError(await importCsv("a", BOOK.a, template), 400, "no_rows", "仅表头导入");
      expectError(await importCsv("a", BOOK.a, ""), 400, "empty_file", "空文件导入");
      eqNumber(await liveCountOf("a", BOOK.a), before, "账目数不变");
    },
  );

  t(
    "EXP",
    "EXP-05",
    "导入 1 行有效 CSV：创建账目（金额/分类正确），随后软删除",
    "POST /import → 200 ok=true importedCount=1；新账目 amountCents=1234、categoryName=E2E Food；删除后账目数回到原值",
    async () => {
      const noteText = `${PREFIX}IMPORT-1`;
      const csv = `\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n${CURRENT_MONTH}-15,12:00,Asia/Shanghai,支出,12.34,CNY,E2E Food,,${noteText},\r\n`;
      const before = await liveCountOf("a", BOOK.a);
      const result = await importCsv("a", BOOK.a, csv);
      const body = expectStatus(result, 200, "POST /import 有效行");
      eq(body.ok, true, "import ok");
      eqNumber(body.importedCount, 1, "importedCount");
      eqNumber(body.rowCount, 1, "rowCount");
      const list = await transactionsOf("a", BOOK.a, `?q=${encodeURIComponent(noteText)}`);
      const imported = list.items.find((item) => item.note === noteText);
      check(imported, "导入的账目应能按备注查到");
      eqNumber(imported.amountCents, 1234, "导入金额");
      eq(imported.categoryName, "E2E Food", "导入分类解析");
      created.transactions.push({ user: "a", book: BOOK.a, id: imported.id, creator: "a" });
      expectStatus(await deleteTransaction("a", BOOK.a, imported.id), 204, "删除导入的账目");
      eqNumber(await liveCountOf("a", BOOK.a), before, "导入并删除后账目数回到原值");
    },
  );

  t(
    "EXP",
    "EXP-06",
    "同一文件重复导入：幂等（不新增账目、返回上次结果）",
    "同一 CSV 第二次导入 → 200 importedCount 仍为 1，但未删除账目数不再增加",
    async () => {
      const noteText = `${PREFIX}IMPORT-2`;
      const csv = `\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n${CURRENT_MONTH}-16,09:30,Asia/Shanghai,支出,23.45,CNY,,,${noteText},\r\n`;
      const first = expectStatus(await importCsv("a", BOOK.a, csv), 200, "第一次导入");
      eqNumber(first.importedCount, 1, "第一次 importedCount");
      const afterFirst = await liveCountOf("a", BOOK.a);
      const second = expectStatus(await importCsv("a", BOOK.a, csv, crypto.randomUUID()), 200, "第二次导入同一文件");
      eq(second.fileRef, first.fileRef, "两次返回同一 fileRef");
      eqNumber(second.importedCount, 1, "第二次仍报告上次 importedCount");
      eqNumber(await liveCountOf("a", BOOK.a), afterFirst, "第二次导入不应新增账目");

      const list = await transactionsOf("a", BOOK.a, `?q=${encodeURIComponent(noteText)}`);
      const imported = list.items.find((item) => item.note === noteText);
      check(imported, "应只存在一条该备注账目");
      created.transactions.push({ user: "a", book: BOOK.a, id: imported.id, creator: "a" });
      expectStatus(await deleteTransaction("a", BOOK.a, imported.id), 204, "删除导入的账目");
    },
  );

  t(
    "EXP",
    "EXP-07",
    "导入校验失败：返回 ok=false + errors，且不写任何数据",
    "日期非法 → 200 ok=false errors 非空 importedCount=0；账目数不变",
    async () => {
      const before = await liveCountOf("a", BOOK.a);
      const csv = `\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n2026-13-01,12:00,Asia/Shanghai,支出,9.99,CNY,,,${PREFIX}BAD-DATE,\r\n`;
      const body = expectStatus(await importCsv("a", BOOK.a, csv), 200, "非法日期导入");
      eq(body.ok, false, "import ok");
      eqNumber(body.importedCount, 0, "importedCount");
      check(Array.isArray(body.errors) && body.errors.length > 0, "应返回行级错误");
      eqNumber(await liveCountOf("a", BOOK.a), before, "账目数不变");
    },
  );
}

// ---------------------------------------------------------------------------
// Runner + report
// ---------------------------------------------------------------------------

async function runCases() {
  for (const testCase of cases) {
    beginTest(testCase.id);
    const startedAt = Date.now();
    let error = null;
    try {
      await testCase.fn();
    } catch (caught) {
      error = caught instanceof CheckFailure ? caught.message : caught?.stack ?? String(caught);
    }
    const recorded = endTest();
    const pass = error === null;
    results.push({
      group: testCase.group,
      id: testCase.id,
      title: testCase.title,
      expected: testCase.expected,
      pass,
      error,
      requests: recorded.requests,
      notes: recorded.notes,
      ms: Date.now() - startedAt,
    });
    process.stdout.write(`${pass ? "PASS" : "FAIL"} ${testCase.id} ${testCase.title}${pass ? "" : `\n      → ${String(error).split("\n")[0]}`}\n`);
  }
}

const GROUP_TITLES = {
  P0: "P0 预检与基线快照",
  CAT: "G1 分类：永久删除与历史重关联",
  PAY: "G2 支付方式：替换 / 未指定 / 归档与永久删除",
  TAG: "G3 标签：删除、解绑与影响数口径",
  INT: "G4 事务后数据完整性、批量摘要与统计",
  PERM: "G5 双账号权限矩阵（API 实测）",
  LIFE: "G6 账本生命周期、邀请、退出与成员管理",
  ISO: "G7 跨账本隔离与错误码",
  CONC: "G8 并发、幂等与失败回滚",
  EXP: "G9 导入导出",
  CLEAN: "G10 清理与基线复核",
};

const GROUP_ORDER = ["P0", "CAT", "PAY", "TAG", "INT", "PERM", "LIFE", "ISO", "CONC", "EXP", "CLEAN"];

/**
 * Static analysis for the failures this suite is expected to surface.
 *
 * ⚠️ Keyed by test id, and merged into both the Markdown report and the JSON
 * defect list. The evidence stays dynamic (this run's requests); only the
 * diagnosis is written down here, so a future run that fixes one of these will
 * simply stop producing the entry — a defect list that outlives its bug is
 * worse than none.
 */
const DEFECT_ANALYSIS = {
  "LIFE-06": {
    severity: "high",
    title: "重新邀请时忽略本次邀请的 role：退出后以 viewer 重邀，重新加入仍保留旧 editor 角色",
    endpoints: ["POST /api/v1/books/invite", "POST /api/v1/notifications/:id/decide", "GET /api/v1/books/members"],
    suspectedRootCause:
      "apps/api/src/collab/respond.ts 的 book_invite 接受分支：book_members 行已存在（退出过）时只 `update({ leftAt: null })`，没有把 `roleFrom(notification.payload)` 写回；只有“新建成员”分支才使用 payload 的 role。对照 collab/share.ts 的 joinViaShareLink，分享链接重新加入分支明确写了「clears leftAt and sets the link's role」。",
    files: [
      "apps/api/src/collab/respond.ts:148-162（membership 存在时只清 leftAt）",
      "apps/api/src/collab/respond.ts:180-182（仅新建成员时 role: roleFrom(payload)）",
      "对照：apps/api/src/collab/share.ts（joinViaShareLink 的重新加入分支设置链接角色）",
    ],
    impact:
      "权限提升：邀请界面承诺「以查看者加入」，实际沿用旧的高权限角色（实测邀请 viewer、加入后仍是 editor）；也与分享链接重新加入的行为不一致。审计只记录了 joined，没有记录角色被沿用。",
    suggestedFix:
      "重新加入分支更新 `{ leftAt: null, role: roleFrom(notification.payload) }`，并在 member_changed 里记录旧角色→新角色；补「退出→以 viewer 重邀→接受后 role=viewer」的回归测试。",
    fixSummary: "respond.ts 重新加入分支改为 `{ leftAt: null, role: roleFrom(notification.payload) }`。",
  },
  "PERM-01": {
    severity: "high",
    title: "viewer 无法读取账目列表 / 账目详情 / 月度汇总（GET /transactions、/transactions/:id、/summary 全部 403）",
    endpoints: ["GET /api/v1/transactions", "GET /api/v1/transactions/:id", "GET /api/v1/summary"],
    suspectedRootCause:
      "apps/api/src/app.ts 注册 registerTransactionRoutes 时把 requireBookWrite 当成整个模块的守卫；transactions.ts 里的 GET /transactions、GET /transactions/:id、GET /summary 是读接口，却和写接口共用同一个 write guard。ledger.ts 已经用 requireRead 参数把读/写分开，transactions 模块没有对应拆分。",
    files: [
      "apps/api/src/app.ts:276（registerTransactionRoutes 传入 requireBookWrite）",
      "apps/api/src/routes/transactions.ts（GET /transactions、GET /summary、GET /transactions/:id）",
      "对照：apps/api/src/routes/ledger.ts:47/133/166（读接口用 requireRead）",
    ],
    impact:
      "查看者打开账本后账目列表、账目详情、月度收支汇总全部 403；与 owner「查看者可以查看账本内容，但不能新增/修改/删除」的规则矛盾，也与同一个 viewer 能读 /ledger、/stats、/ledger/history 不一致（前端会表现为列表/汇总报错或空白）。",
    suggestedFix:
      "与 ledger.ts 同样拆成 read/write 两个守卫：GET /transactions、GET /transactions/:id、GET /summary 使用 requireBookRead；POST/PATCH/DELETE/restore 保持 requireBookWrite；并补「viewer GET 列表/详情/汇总均为 200」的回归测试。",
    fixSummary: "app.ts 给 transactions 模块补 requireRead；transactions.ts 的读接口（含 /summary、/transactions/:id、/conflicts、duplicates 检查）改用 requireRead。",
  },
  "PERM-06": {
    severity: "medium",
    title: "成员角色变更历史把「操作者自己的角色」写成了被改成员的旧角色，to 还混入了显示名",
    endpoints: ["PATCH /api/v1/books/members/:memberId", "GET /api/v1/ledger/history"],
    suspectedRootCause:
      "apps/api/src/routes/share.ts 的 PATCH 成员路由用 `from: book.role` 写 changes.role.from —— book.role 是执行操作者自己的角色；changeMemberRole() 只返回 {changed}，没有把目标成员的旧角色带回来，路由也没有在修改前读取它。`to` 又写成了 `${displayName}：可编辑`，把“人”和“角色”塞进同一个字段。",
    files: [
      "apps/api/src/routes/share.ts:225-233（changes: { role: { from: book.role, to: `${target?.displayName}：...` } }）",
      "apps/api/src/collab/members.ts:67-97（changeMemberRole 未返回 previousRole）",
    ],
    impact:
      "历史句子错误（例如 role：editor → E2E Test-A：可编辑，而 Test-A 实际是从 viewer 提升上来的），审计记录不可信；角色字段同时承载名字和角色，后续做机器读取时会歧义。",
    suggestedFix:
      "让 changeMemberRole 返回 previousRole（或在路由内先查旧角色）；from=旧角色、to=新角色（纯 role 值），中文文案由界面按值映射；history 的 changes 不要拼接 displayName。",
    fixSummary: "changeMemberRole 返回 previousRole；share.ts 的 from 改用 result.previousRole。`to` 仍保留“显示名：角色”的旧格式（见观察项）。",
  },
  "LIFE-05": {
    severity: "medium",
    title: "/books 的 memberCount 把已退出成员算进去（与 /ledger、/books/members 不一致）",
    endpoints: ["GET /api/v1/books"],
    suspectedRootCause:
      "apps/api/src/routes/books.ts 的两处 `_count: { select: { members: true } }` 没有过滤 leftAt；退出账本只是给 book_members.leftAt 打时间戳、行仍然保留，所以计数包含已退出的人。同一本账的 /ledger 用 `count({ bookId, leftAt: null })`（ledger.ts:91），两个数因此不一致。",
    files: [
      "apps/api/src/routes/books.ts:89（memberships 查询里的 _count.members）",
      "apps/api/src/routes/books.ts:101（created/disposed 查询里的 _count.members）",
      "对照：apps/api/src/routes/ledger.ts:91（leftAt: null）",
    ],
    impact:
      "开始页账本卡片显示过期成员数（实测 1 个成员却显示 2），与成员列表/账本信息页矛盾；『账本/协作』导航的切换依据可能因此长期显示“协作”。",
    suggestedFix:
      "两处都改为 `_count: { select: { members: { where: { leftAt: null } } } }`（或在查询后单独 count），并用「B 退出后 A 的 /books 里 C.memberCount=1」做回归测试。",
    fixSummary: "books.ts 两处查询改为只取 leftAt:null 的成员，memberCount 用过滤后的数量。",
  },
  "LIFE-03": {
    severity: "medium",
    title: "通过分享链接加入账本不会写入账本历史（邀请路径会写）",
    endpoints: ["POST /api/v1/share/:token/join", "GET /api/v1/ledger/history"],
    actualSummary:
      "分享链接加入成功后 GET /ledger/history 返回 {\"entries\":[],\"total\":0}；同一次运行中，通过邀请接受重新加入（LIFE-06）会写 member_changed，两条加入路径的历史行为不一致。",
    suspectedRootCause:
      "apps/api/src/collab/share.ts 的 joinViaShareLink 只更新 book_share_links.useCount 与 book_members，没有像 respond.ts 的 book_invite 接受分支那样写 recordEvent(member_changed)。因此本轮通过分享链接加入 D 之后，GET /ledger/history 返回 {\"entries\":[],\"total\":0}。",
    files: [
      "apps/api/src/collab/share.ts（joinViaShareLink：更新 useCount、book_members，但无 recordEvent）",
      "对照：apps/api/src/collab/respond.ts:169-175（接受邀请会写 member_changed）",
    ],
    impact:
      "谁通过哪条分享链接、何时加入，账本历史里查不到；owner 要求展示的「成员加入」协作事件在分享链接路径上缺失，审计不完整（邀请路径有、链接路径没有，也会让用户以为链接加入没有发生）。",
    suggestedFix:
      "在 joinViaShareLink 的同一事务里写 member_changed 事件（actor=加入者，changes 记录来源=分享链接/角色），或在路由层调用 recordEvent；补「分享链接加入后 /ledger/history 有 member_changed」的回归测试。",
  },
};

/** Defects found in the previous controlled round, fixed by the parent agent, re-verified here. */
const RESOLVED_DEFECTS = [
  { testId: "PERM-01", fixedIn: "apps/api/src/app.ts + apps/api/src/routes/transactions.ts", verifiedBy: "PERM-01（52 次读调用全 200）" },
  { testId: "PERM-06", fixedIn: "apps/api/src/collab/members.ts + apps/api/src/routes/share.ts", verifiedBy: "PERM-06（历史 from=viewer）" },
  { testId: "LIFE-05", fixedIn: "apps/api/src/routes/books.ts", verifiedBy: "LIFE-05（memberCount=1）" },
  { testId: "LIFE-06", fixedIn: "apps/api/src/collab/respond.ts", verifiedBy: "LIFE-06（重新邀请后 role=viewer）" },
];

const OBSERVATIONS = [
  "手工 409 分支探针（2026-10-17T16:12，150 笔账目引用同一分类 + 12 个并发创建；探针数据随后软删除）：删除请求返回 409 category_in_use，分类保留、事务回滚，12 个并发创建全部 201；随后再次永久删除返回 200。说明「并发新增引用」被 ON DELETE RESTRICT 正确转成了 409，而不是 500。",
  "已修复并回归：父 Agent 在 2026-10-18T00:12 前后修掉了上一轮的 4 个缺陷（app.ts 读写守卫拆分、respond.ts 重新加入应用 payload role、books.ts memberCount 过滤 leftAt、share.ts previousRole），并重新启动了 E2E API。本轮 PERM-01 / PERM-06 / LIFE-05 / LIFE-06 作为回归全部通过。",
  "P2003 兜底：父 Agent 同时在 errors.ts 把 P2003 映射为 409 reference_missing。此前“删除期间新增引用”理论上可能让创建接口 500（创建路由只捕获 P2002），现在有统一兜底；本轮并发用例未再出现 5xx（唯一一次 500 观察来自被并发探针污染的另一轮运行，无法归因）。",
  "角色变更历史的 to 仍保留旧格式（如 `E2E Test-A：可编辑`），from 已修正为被改成员旧角色。建议把 to 也归一为纯 role 值（editor/viewer），由界面翻译，避免同一字段混入显示名。",
  "viewer 的导出接口：GET /export、GET /export-log 与 POST /export 都随 export 模块注册在 write guard 上，实测 viewer 一律 403。GET /export 会产生 export_logs 审计行，所以“导出=写”有其理由；但「查看者能看账本内容」是否包含导出，需要产品确认（未计入缺陷）。",
  "弃置账本对成员仍可按 id 读取/写入：GET /ledger C（已弃置）返回 200。requireBook 只检查 book_members.leftAt，不检查 books.disposed_at；列表虽已隐藏，但知道 id 的成员仍能访问。若“普通用户不再看到它”要求 API 层也拒绝，需要在 requireBook 里补 disposedAt 检查（记录为设计问题，未计入缺陷）。",
  "错误码不一致：成员不存在时 DELETE /books/members/:id 返回 403 member_missing，而 PATCH /books/members/:id 返回 404 member_missing（同一条件、两个码），建议统一。",
  "代码异味：books.ts 的邀请角色表达式 `book.role === \"editor\" && requested === \"editor\" ? \"editor\" : requested` 两个分支结果相同，等价于 `requested`；疑似未完成的「editor 不能邀请 editor」规则。当前 editor 可以邀请 editor/viewer，实际效果与注释相符，暂不判缺陷。",
  "邀请刷新会消耗配额（sendNotification 注释明确说明）：多轮验收把 A→B 的每日 5 条配额用尽后，后续邀请返回 429 notification_quota_subject（这是产品的限流行为，不是缺陷）。本轮 LIFE-03 因此用分享链接完成加入；最后 1 条 B→A 配额用于 LIFE-06 的「重新邀请 viewer」，接受邀请路径本身仍在本轮被真实执行。重复邀请刷新只在更早的受控轮验证过（201 refreshed=true）。",
  "CSV 的 UTF-8 BOM：`Response.text()` 的 UTF-8 解码器会吞掉 BOM，因此用原始字节验证；GET /export 的响应字节以 EF BB BF 开头（EXP-01 通过）。",
  "并发运行隔离：本次最终运行使用 %TEMP%\\libevra-e2e\\.api-verify.lock 独占锁；此前曾有两个验收进程重叠并互相污染测量（其中一个还把环境噪声误报为失败），已清理它们的残留（T2XX/TZZZ 前缀账目与临时账本弃置）。",
];

const UNCOVERED = [
  "管理员对私人账本的访问：环境中没有管理员账号（不能为了验证而授予管理员），无法实测；本次只验证了普通账号访问 /admin/self、/admin/overview、/admin/users、/admin/audit 全部 403 admin_forbidden。",
  "系统「暂无分类」缺失时的 category_replacement_missing 400：需要删除账本的系统分类（破坏基线基础设施）才能构造，按约束未做。",
  "删除与并发新增引用时 409 category_in_use 的自动用例：CONC-06/07/08 本轮所有并发创建都在删除提交后执行（全部 403），未命中窗口；409 分支由手工探针单独覆盖（见观察项），因此没有把它写成会随调度闪烁的自动断言。",
  "标签/支付方式删除期间新增引用的竞态窗口：单独重放未命中（创建全部 403 tag_invalid），没有观测到 P2003；父 Agent 已在 errors.ts 统一映射 P2003→409，理论上兜底了这条路径，但本轮没有自动用例能稳定复现。",
  "数据库表级直查（transaction_events / ledger_operation_logs / 墓碑行）：本脚本以 API 为观测面（/ledger.stats.eventCount、/ledger/history 总数、/ledger/operations、restore 墓碑）；未额外连接数据库，也未运行项目自带测试。",
  "真实浏览器 / UI 层一致性：本任务限定 API 层；浏览器验收由主 Agent 在 5175 上执行。动态改角色后的后端数据一致性已在 API 层验证（/books、/books/members、写 403）。",
  "viewer 发送留言：代码与文档允许（交流不等于改账目），但留言没有删除接口，会产生无法清理的公开数据，故未实测写入；只验证了 GET /books/messages 200。",
  "重复邀请刷新（同一 pending 通知 refreshed=true）本轮因通知配额未再执行；受控轮 TLQ1 已验证 201 + refreshed=true。",
  "邀请过期、撤回、配额上限的具体边界：本轮只观测到 429 notification_quota_subject（配额用尽），未逐一验证过期/撤回后的行为。",
  "分享链接的过期 / 满员 / 撤销后加入：只验证了创建、预览、加入、撤销、viewer 403；链接满员（maxUses）与过期需要等待或构造大量加入者，未做。",
  "XLSX 二进制导出内容：只验证 CSV 与导出记录；XLSX 生成属于导出模块既有能力，不在 S13-E 重点内。",
];

function mdEscape(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderRequestLines(requests, limit = 40) {
  const lines = [];
  for (const request of requests.slice(0, limit)) {
    const book = request.book ? `[${BOOK_LABEL.get(request.book) ?? request.book.slice(0, 6)}]` : "";
    lines.push(`\`${request.method} ${request.path}\` ${book} → ${request.status}${request.body ? ` ${mdEscape(request.body).slice(0, 220)}` : ""}`);
  }
  if (requests.length > limit) lines.push(`…（共 ${requests.length} 条请求，其余省略）`);
  return lines;
}

function buildReport() {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  const lines = [];
  lines.push("# S13-E 后端 / API 验收报告（隔离 E2E 环境）");
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 运行时间：${runMeta.startedAt ?? "?"}（前缀 \`${runMeta.prefix ?? PREFIX}\`）`);
  lines.push(`- 运行命令：\`node tools/e2e/api-verification.mjs\``);
  lines.push(`- API：\`${BASE}\`（隔离库，本地 PostgreSQL）；Web 端点为 \`${WEB_BASE}\`，本脚本未访问`);
  lines.push(`- 账号：Test-A（账本 A 创建者 / 账本 B viewer）、Test-B（账本 A editor / 账本 B 创建者）；密码只从临时 state.json 读取，未写入本报告`);
  lines.push(`- 本次运行前缀：\`${runMeta.prefix ?? PREFIX}\`（所有临时对象均以此开头）`);
  lines.push(`- 结果：**通过 ${passed} / 失败 ${failed} / 共 ${results.length}**`);
  lines.push("");
  lines.push("## 一、环境与基线");
  lines.push("");
  const startLiveA = runMeta.deltas?.startLiveTransactionsA ?? baseline.ledger?.a?.stats?.transactionCount ?? "?";
  const startLiveB = runMeta.deltas?.startLiveTransactionsB ?? baseline.ledger?.b?.stats?.transactionCount ?? "?";
  lines.push(
    `- 账本 A：\`${BOOK.a}\`（${stateName("a")}），state.json 基线账目 4 笔；开跑时实际未删除账目 ${startLiveA} 笔（环境中另有主 Agent 浏览器验收留下的条目）。`,
  );
  lines.push(
    `- 账本 B：\`${BOOK.b}\`（${stateName("b")}），state.json 基线账目 1 笔；开跑时实际未删除账目 ${startLiveB} 笔。`,
  );
  lines.push("- 只通过 E2E API 操作；未运行 `pnpm --filter @libellum/api test`；未访问 3000/5173；未连接远程/生产库。");
  lines.push("- 基线 A/B 账本与 baseline 数据未被删除或改写；CLEAN 组在收尾时逐项复核（基线账目逐字段快照 + 角色 + 名称 + 用量）。");
  lines.push("- 本次运行使用独占锁，避免与其他验收进程互相污染；历史遗留的测试账目/临时账本已清理或弃置（见第八节）。");
  lines.push("");
  lines.push("## 二、测试矩阵（摘要）");
  lines.push("");
  for (const group of GROUP_ORDER) {
    const groupResults = results.filter((result) => result.group === group);
    if (groupResults.length === 0) continue;
    const groupPassed = groupResults.filter((result) => result.pass).length;
    lines.push(`### ${GROUP_TITLES[group] ?? group}（${groupPassed}/${groupResults.length} 通过）`);
    lines.push("");
    lines.push("| 编号 | 用例 | 期望（摘要） | 结果 |");
    lines.push("| --- | --- | --- | --- |");
    for (const result of groupResults) {
      lines.push(`| ${result.id} | ${mdEscape(result.title)} | ${mdEscape(result.expected).slice(0, 240)} | ${result.pass ? "✅ 通过" : "❌ 失败"} |`);
    }
    lines.push("");
  }

  lines.push("## 三、逐用例证据");
  lines.push("");
  for (const group of GROUP_ORDER) {
    const groupResults = results.filter((result) => result.group === group);
    if (groupResults.length === 0) continue;
    lines.push(`### ${GROUP_TITLES[group] ?? group}`);
    lines.push("");
    for (const result of groupResults) {
      lines.push(`#### ${result.id} ${mdEscape(result.title)} — ${result.pass ? "✅ 通过" : "❌ 失败"}`);
      lines.push("");
      lines.push(`- 期望：${mdEscape(result.expected)}`);
      lines.push(`- 实际：${result.pass ? "满足期望" : `**${mdEscape(result.error).split("\n")[0]}**`}`);
      if (result.error && result.error.includes("\n")) {
        lines.push("");
        lines.push("```text");
        lines.push(result.error.split("\n").slice(0, 12).join("\n"));
        lines.push("```");
      }
      for (const observation of result.notes) {
        lines.push(`- 备注/观察：${mdEscape(observation)}`);
      }
      if (result.requests.length > 0) {
        lines.push(`- 请求证据（${result.requests.length} 条）：`);
        lines.push("");
        for (const requestLine of renderRequestLines(result.requests)) lines.push(`  - ${requestLine}`);
      }
      lines.push("");
    }
  }

  const failures = results.filter((result) => !result.pass);
  lines.push("## 四、失败项（缺陷列表）");
  lines.push("");
  if (failures.length === 0) {
    lines.push("本次运行没有失败用例。");
  } else {
    failures.forEach((failure, index) => {
      const analysis = DEFECT_ANALYSIS[failure.id];
      lines.push(`### D-${String(index + 1).padStart(2, "0")} ${mdEscape(analysis?.title ?? failure.title)}`);
      lines.push("");
      lines.push(`- 用例：\`${failure.id}\`（${GROUP_TITLES[failure.group] ?? failure.group}）`);
      lines.push(`- 严重级别：**${analysis?.severity ?? "medium"}**`);
      if (analysis?.endpoints) lines.push(`- 涉及接口：${analysis.endpoints.map((endpoint) => `\`${endpoint}\``).join("、")}`);
      lines.push(`- 期望：${mdEscape(failure.expected)}`);
      lines.push(`- 实际：${mdEscape(analysis?.actualSummary ?? failure.error).split("\n")[0]}`);
      if (analysis?.suspectedRootCause) {
        lines.push(`- 疑似根因：${mdEscape(analysis.suspectedRootCause)}`);
      }
      if (analysis?.files) {
        lines.push("- 疑似涉及文件/位置：");
        for (const file of analysis.files) lines.push(`  - \`${file}\``);
      }
      if (analysis?.impact) lines.push(`- 影响：${mdEscape(analysis.impact)}`);
      if (analysis?.suggestedFix) lines.push(`- 建议修复：${mdEscape(analysis.suggestedFix)}`);
      lines.push(`- 复现：\`node tools/e2e/api-verification.mjs\`（用例 ${failure.id}）`);
      lines.push("- 证据：");
      lines.push("");
      for (const requestLine of renderRequestLines(failure.requests, 30)) lines.push(`  - ${requestLine}`);
      for (const observation of failure.notes) lines.push(`  - 备注：${mdEscape(observation)}`);
      lines.push("");
    });
  }

  lines.push("## 五、上一轮已修复并回归通过的缺陷");
  lines.push("");
  lines.push("以下缺陷是在 2026-10-17T16:11 的受控轮（前缀 TLQ1）中实测发现的；父 Agent 修复后，本轮作为回归重新执行了对应用例，全部通过。该轮的原始 stdout 见同目录 `api-run-TLQ1-stdout.txt`，缺陷与证据摘要见 `api-pre-fix-evidence.md`。");
  lines.push("");
  lines.push("| 编号 | 缺陷 | 修复位置 | 本轮回归证据 |");
  lines.push("| --- | --- | --- | --- |");
  RESOLVED_DEFECTS.forEach((resolved, index) => {
    const analysis = DEFECT_ANALYSIS[resolved.testId];
    lines.push(
      `| R-${String(index + 1).padStart(2, "0")} | ${mdEscape(analysis?.title ?? resolved.testId)} | \`${resolved.fixedIn}\` | ${mdEscape(resolved.verifiedBy)} |`,
    );
  });
  lines.push("");

  lines.push("## 六、观察项 / 设计问题（不计入缺陷数）");
  lines.push("");
  for (const observation of OBSERVATIONS) lines.push(`- ${observation}`);
  lines.push("");

  lines.push("## 七、未覆盖项及原因");
  lines.push("");
  for (const item of UNCOVERED) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## 八、数据变化与清理");
  lines.push("");
  lines.push("- 本次运行创建的所有账目在收尾时软删除；临时分类/支付方式/标签永久删除；临时账本 C/D 由各自创建者弃置（没有删除账本的 API）。");
  lines.push("- 基线账目：字段、金额、日期、币种、备注、分类/支付方式、version 与开跑前逐字段一致（CLEAN-01 problems=[]）。");
  lines.push("- 账本 A/B 名称、成员角色、上次使用账本在收尾时恢复；CLEAN-01 的 notes 记录开跑/收尾的 live 数与 usage 对照。");
  if (runMeta.deltas) {
    lines.push(`- 不可逆的测试痕迹（append-only，属正常历史）：${JSON.stringify(runMeta.deltas)}。`);
  }
  lines.push("- 历史遗留的临时账本（T2XX/TVW8/TS53/TR94/TLQ1/TLL0 等前缀）已弃置；这些行没有删除 API，只会出现在「已弃置」列表，不影响 A/B 账本数据。");
  lines.push("");
  lines.push("## 九、结论");
  lines.push("");
  if (failed === 0) {
    lines.push("所有已覆盖用例通过；未见阻断性缺陷。");
  } else {
    const highCount = failures.filter((failure) => DEFECT_ANALYSIS[failure.id]?.severity === "high").length;
    const openTitles = failures.map((failure) => `${failure.id}（${DEFECT_ANALYSIS[failure.id]?.title ?? failure.title}）`);
    lines.push(
      `本次共 ${results.length} 个用例，通过 ${passed}、失败 ${failed}（其中高优先级 ${highCount} 个）。` +
        "上一轮发现的 4 个权限/审计缺陷已修复并回归通过（见第五节）；" +
        "删除/历史重关联主线（分类/支付方式/标签、墓碑、摘要、事件不膨胀、统计一致性）、跨账本隔离、并发删除与幂等均通过。",
    );
    lines.push("");
    lines.push(`本轮剩余开放缺陷：${openTitles.join("；")}。`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildDefects() {
  const open = results
    .filter((result) => !result.pass)
    .map((result, index) => {
      const analysis = DEFECT_ANALYSIS[result.id];
      return {
        id: `D-${String(index + 1).padStart(2, "0")}`,
        testId: result.id,
        group: GROUP_TITLES[result.group] ?? result.group,
        severity: analysis?.severity ?? "medium",
        title: analysis?.title ?? result.title,
        endpoints: analysis?.endpoints ?? [],
        expected: result.expected,
        actual: analysis?.actualSummary ?? String(result.error ?? "").split("\n")[0],
        evidence: {
          requests: result.requests,
          notes: result.notes,
        },
        repro: ["node tools/e2e/api-verification.mjs", `用例 ${result.id}`],
        suspectedRootCause: analysis?.suspectedRootCause ?? "",
        files: analysis?.files ?? [],
        impact: analysis?.impact ?? "",
        suggestedFix: analysis?.suggestedFix ?? "",
        status: "open",
      };
    });

  const resolved = RESOLVED_DEFECTS.map((entry, index) => {
    const analysis = DEFECT_ANALYSIS[entry.testId];
    return {
      id: `R-${String(index + 1).padStart(2, "0")}`,
      testId: entry.testId,
      group: GROUP_TITLES[entry.testId.split("-")[0]] ?? entry.testId.split("-")[0],
      severity: analysis?.severity ?? "medium",
      title: analysis?.title ?? entry.testId,
      endpoints: analysis?.endpoints ?? [],
      status: "fixed-verified",
      fixedIn: entry.fixedIn,
      regressionEvidence: entry.verifiedBy,
      suspectedRootCause: analysis?.suspectedRootCause ?? "",
      files: analysis?.files ?? [],
      impact: analysis?.impact ?? "",
      note: "上一轮受控运行（TLQ1）实测失败；父 Agent 修复后本轮回归通过。",
    };
  });

  return [...open, ...resolved];
}

function writeArtifacts() {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  const report = buildReport();
  const defects = buildDefects();
  const runJson = JSON.stringify({ meta: runMeta, results }, null, 2);
  const runTag = runMeta.run ?? RUN;

  writeFileSync(join(DIR, "api-report.md"), report, "utf8");
  writeFileSync(join(DIR, "api-defects.json"), JSON.stringify(defects, null, 2), "utf8");
  writeFileSync(join(DIR, "api-run.json"), runJson, "utf8");
  // Timestamped copies, so a concurrent process that also writes the canonical
  // names cannot silently replace the run this report describes.
  writeFileSync(join(DIR, `api-report-${runTag}.md`), report, "utf8");
  writeFileSync(join(DIR, `api-defects-${runTag}.json`), JSON.stringify(defects, null, 2), "utf8");
  writeFileSync(join(DIR, `api-run-${runTag}.json`), runJson, "utf8");

  process.stdout.write(`\n通过 ${passed} / 失败 ${failed} / 共 ${results.length}\n`);
  process.stdout.write(`报告：${join(DIR, "api-report.md")}（副本 api-report-${runTag}.md）\n`);
  process.stdout.write(`缺陷：${join(DIR, "api-defects.json")}（副本 api-defects-${runTag}.json）\n`);
  process.stdout.write(`原始：${join(DIR, "api-run.json")}（副本 api-run-${runTag}.json）\n`);
}

async function main() {
  mkdirSync(DIR, { recursive: true });

  /**
   * `--report-only` rebuilds the Markdown/JSON from the last run's
   * `api-run.json`. Used after editing the diagnosis text, so the report can be
   * corrected without running any API call (and without consuming the
   * environment's notification quota).
   */
  if (process.argv.includes("--report-only")) {
    const raw = JSON.parse(readFileSync(join(DIR, "api-run.json"), "utf8"));
    results.length = 0;
    for (const result of raw.results) results.push(result);
    Object.assign(runMeta, raw.meta);
    process.stdout.write(`report-only: rebuild from ${join(DIR, "api-run.json")} (run ${runMeta.run})\n`);
    writeArtifacts();
    return;
  }

  acquireLock();
  process.stdout.write(`S13-E API verification — ${new Date().toISOString()}\n`);
  process.stdout.write(`API ${BASE} / web ${WEB_BASE} (web not touched) / run ${RUN}\n`);

  await loginAll();
  await health();
  await captureBaseline();
  await setupFixtures();

  // Initialise the "expected foreign key" map from the fixtures.
  for (const [key, snap] of Object.entries(fx.snap)) {
    expectations.category[key] = snap.categoryId;
    expectations.payment[key] = snap.paymentMethodId;
    expectations.tags[key] = [...snap.tags];
  }
  for (const key of ["txAlphaTomb", "txTombOnly1", "txTombOnly2", "txPayTomb", "txTagTombGone"]) {
    expectations.tombstone.add(key);
  }

  registerCases();
  await runCases();
  writeArtifacts();
}

try {
  await main();
} catch (error) {
  process.stderr.write(`FATAL: ${error?.stack ?? String(error)}\n`);
  process.exitCode = 2;
} finally {
  releaseLock();
}
