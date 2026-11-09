import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEnterLedger } from "./DesktopNav.js";
import { dashboardDestination } from "./dashboardNavigation.js";

const state = vi.hoisted(() => ({
  current: "a", pathname: "/dashboard", guest: false,
  activate: vi.fn<(id: string) => Promise<void>>(),
  navigate: vi.fn(), assign: vi.fn(),
}));
vi.mock("react-router", async (original) => ({ ...await original<typeof import("react-router")>(), useNavigate: () => state.navigate, useLocation: () => ({ pathname: state.pathname }) }));
vi.mock("../lib/guest/session.js", () => ({ useGuestMode: () => state.guest }));
vi.mock("../lib/queries.js", async (original) => ({
  ...await original<typeof import("../lib/queries.js")>(),
  useLedger: () => ({ data: { book: { id: state.current } } }),
  useActivateBook: () => ({ isPending: false, mutateAsync: state.activate }),
}));

function enter(): ReturnType<typeof useEnterLedger> {
  let result: ReturnType<typeof useEnterLedger> | undefined;
  function Probe() { result = useEnterLedger(); return null; }
  renderToStaticMarkup(<Probe />);
  return result!;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.current = "a";
  state.guest = false;
  state.activate.mockResolvedValue();
  vi.stubGlobal("window", { location: { assign: state.assign } });
});

describe("Dashboard 进入账本先激活，再跳转", () => {
  it("激活完成前不跳转；完成后将月份和图表目标带到整页载入", async () => {
    let finish: (() => void) | undefined;
    state.activate.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const destination = dashboardDestination("2026-10", "expense", "USD");
    enter().enter("b", undefined, destination);
    expect(state.activate).toHaveBeenCalledWith("b");
    expect(state.assign).not.toHaveBeenCalled();
    finish!();
    await Promise.resolve();
    expect(state.assign).toHaveBeenCalledWith(destination);
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("激活失败保持当前页，不把加号和明细切到错误账本", async () => {
    state.activate.mockRejectedValue(new Error("offline"));
    enter().enter("b", undefined, dashboardDestination("2026-10"));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.assign).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it("进入当前账本直接导航，不依赖联网激活", () => {
    const destination = dashboardDestination("2026-10");
    enter().enter("a", undefined, destination);
    expect(state.activate).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith(destination);
  });
});

describe("手机账本胶囊切换：海浪遮挡只改变载入期间看到什么", () => {
  it("rise：仍是激活成功后整页重新载入；没有海浪呈现器时直接激活", async () => {
    let result: ReturnType<typeof useEnterLedger> | undefined;
    function Probe() { result = useEnterLedger({ rise: true }); return null; }
    renderToStaticMarkup(<Probe />);
    result!.enter("b", undefined, "/stats");
    expect(state.activate).toHaveBeenCalledWith("b");
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(state.assign).toHaveBeenCalledWith("/stats");
  });
  it("rise：激活失败不载入", async () => {
    state.activate.mockRejectedValue(new Error("offline"));
    let result: ReturnType<typeof useEnterLedger> | undefined;
    function Probe() { result = useEnterLedger({ rise: true }); return null; }
    renderToStaticMarkup(<Probe />);
    result!.enter("b", undefined, "/");
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(state.assign).not.toHaveBeenCalled();
  });
});
