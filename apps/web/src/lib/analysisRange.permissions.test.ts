/** 执行真实hook effect，查询状态使用真实QueryClient；不需要DOM或外部服务。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Transaction } from "@libellum/shared";
import { ApiRequestError } from "./api.js";

const fixture = vi.hoisted(() => ({
  client: null as any,
  snapshot: [] as any[],
  originals: null as null | (() => Promise<any[]>),
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const index = fixture.cursor++;
      const old = fixture.slots[index];
      if (old === undefined || !deps.every((value, part) => Object.is(value, old.deps[part]))) fixture.slots[index] = { value: make(), deps };
      return fixture.slots[index].value;
    },
    useRef: (value: unknown) => {
      const index = fixture.cursor++;
      fixture.slots[index] ??= { current: value };
      return fixture.slots[index];
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = fixture.cursor++;
      const old = fixture.slots[index];
      if (old === undefined || !deps.every((value, part) => Object.is(value, old.deps[part]))) {
        old?.cleanup?.();
        const slot = { deps, cleanup: undefined as void | (() => void) };
        fixture.slots[index] = slot;
        fixture.effects.push(() => { slot.cleanup = effect(); });
      }
    },
  };
});
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => fixture.client,
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const state = fixture.client.getQueryState(queryKey);
    return { data: state?.data, error: state?.error ?? null, isPending: state?.status === "pending", isError: state?.status === "error", isFetching: state?.fetchStatus === "fetching", refetch: vi.fn() };
  },
}));
vi.mock("../auth/AuthProvider.js", () => ({ useAuthOptional: () => ({ user: { id: "a" } }) }));
vi.mock("./queries.js", () => ({ useCurrentBookId: () => "b" }));
// S18：工作区账本（这里只测设备当前账本这一路）。
vi.mock("./workspaceLedger.js", () => ({ useForeignBookId: () => null, foreignKey: (...parts: unknown[]) => ["ws-ledger", ...parts] }));
vi.mock("./offline/connectivity.js", () => ({ useAccountOffline: () => ({ offline: false }) }));
vi.mock("./offline/scope.js", () => ({ offlineScope: () => "a:b" }));
vi.mock("./offline/localLedger.js", () => ({
  ledgerSnapshotValue: () => fixture.snapshot,
  subscribeLedger: () => () => {},
  readLocalTransactions: () => fixture.originals?.() ?? Promise.resolve(fixture.snapshot),
  filterLocally: (entries: readonly unknown[]) => entries,
  readMarks: () => Promise.resolve({}), readStoredMonths: () => Promise.resolve({}), storeMonth: () => Promise.resolve(),
}));
vi.mock("./offline/storage.js", () => ({ readValue: () => Promise.resolve(null), writeValue: () => Promise.resolve(true) }));

import { useAnalysisRange, type AnalysisRangeRead } from "./analysisRange.js";

const range = { from: "2026-10-01", to: "2026-10-27" };
const key = ["analysis-range", "a", "b", range.from, range.to, false];
const row = { id: "previously-authorized", version: 1, amountCents: 100, occurredLocalDate: "2026-10-03", deletedAt: null } as Transaction;
const read: AnalysisRangeRead = { entries: [row], remoteEntries: [row], sourceComplete: true, offline: false };
function render() {
  fixture.cursor = 0;
  const value = useAnalysisRange(range);
  while (fixture.effects.length > 0) fixture.effects.shift()!();
  return value;
}
async function settle() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function refuse() {
  fixture.client.getQueryCache().find({ queryKey: key })!.setState({ status: "error", error: new ApiRequestError(403, "book_forbidden", "revoked") });
}
beforeEach(() => {
  fixture.client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  fixture.client.setQueryData(key, read);
  fixture.snapshot = [row]; fixture.originals = null; fixture.cursor = 0; fixture.slots = []; fixture.effects = [];
});

describe("W5权限拒绝不能被本机更新恢复为成功", () => {
  it("成功后403，再发生本机revision，旧data不返回且错误不被setQueryData清掉", async () => {
    expect(render().data).toBeDefined();
    await settle();
    refuse();
    fixture.snapshot = [{ ...row, version: 2 }];
    const rejected = render();
    expect(rejected.permissionDenied).toBe(true);
    expect(rejected.data).toBeUndefined();
    await settle();
    expect(fixture.client.getQueryState(key)?.status).toBe("error");
    expect(render().data).toBeUndefined();
  });

  it("本机合并await期间服务器403，即使尚未重渲染也不能提交迟到合并", async () => {
    let resolve!: (rows: Transaction[]) => void;
    fixture.originals = () => new Promise((answer) => { resolve = answer; });
    render();
    refuse();
    resolve([row]);
    await settle();
    expect(fixture.client.getQueryState(key)?.status).toBe("error");
    expect(render().data).toBeUndefined();
  });
});
