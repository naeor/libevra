import { describe, expect, it } from "vitest";
import { availableThemePreference, createThemeController, restoreThemeBeforePaint } from "./theme.js";

function environment(raw: string | null = null) {
  let value = raw;
  let writes = 0;
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: false,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
  };
  const storage = { getItem: () => value, setItem: (_: string, next: string) => { value = next; writes++; } };
  const changeSystem = (matches: boolean): void => { media.matches = matches; for (const listener of [...listeners]) listener({ matches } as MediaQueryListEvent); };
  return { root, storage, media: media as unknown as MediaQueryList, changeSystem, listenerCount: () => listeners.size, value: () => value, writes: () => writes };
}

describe("主题入口与首屏共用 B0 契约", () => {
  it("首屏恢复与运行时一致，并设置原生控件色系", () => {
    const env = environment('{"mode":"dark","palette":"green"}');
    restoreThemeBeforePaint(env.root, env.storage, false);
    expect(env.root.dataset["themeMode"]).toBe("dark");
    expect(env.root.style.colorScheme).toBe("dark");
    const controller = createThemeController(env.root, env.storage, env.media);
    expect(controller.getSnapshot()).toEqual({ mode: "dark", palette: "green" });
    expect(env.writes()).toBe(0);
    controller.dispose();
  });
  it("跟随系统实时变化；手动选择会移除监听并覆盖后续系统变化", () => {
    const env = environment();
    const controller = createThemeController(env.root, env.storage, env.media);
    controller.choose({ mode: "system" });
    expect(env.listenerCount()).toBe(1);
    env.changeSystem(true);
    expect(env.root.dataset["themeMode"]).toBe("dark");
    expect(controller.getSnapshot().mode).toBe("system");
    controller.choose({ mode: "light" });
    expect(env.listenerCount()).toBe(0);
    env.changeSystem(true);
    expect(env.root.dataset["themeMode"]).toBe("light");
    controller.choose({ mode: "dark" });
    env.changeSystem(false);
    expect(env.root.dataset["themeMode"]).toBe("dark");
  });
  it("刷新恢复两维偏好；七套已映射色盘可独立选择", () => {
    const env = environment();
    const first = createThemeController(env.root, env.storage, env.media);
    first.choose({ mode: "dark" });
    first.choose({ palette: "purple" });
    expect(first.getSnapshot().mode).toBe("dark");
    expect(JSON.parse(env.value()!)).toEqual({ mode: "dark", palette: "purple" });
    first.dispose();
    const second = createThemeController(env.root, env.storage, env.media);
    expect(second.getSnapshot()).toEqual({ mode: "dark", palette: "purple" });
    expect(availableThemePreference({ mode: "system", palette: "purple" })).toEqual({ mode: "system", palette: "purple" });
  });
  it("跨标签恢复不回写，损坏偏好回退，订阅可清理", () => {
    const env = environment();
    const controller = createThemeController(env.root, env.storage, env.media);
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => { notifications++; });
    controller.restore('{"mode":"system","palette":"green"}');
    expect(env.writes()).toBe(0);
    expect(notifications).toBe(1);
    unsubscribe();
    controller.restore("broken");
    expect(controller.getSnapshot()).toEqual({ mode: "light", palette: "green" });
    expect(notifications).toBe(1);
    expect(env.listenerCount()).toBe(0);
  });
  it("存储拒绝时仍能切换，默认浅色不受系统深色影响", () => {
    const env = environment();
    env.changeSystem(true);
    const controller = createThemeController(env.root, { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, env.media);
    expect(env.root.dataset["themeMode"]).toBe("light");
    expect(() => controller.choose({ mode: "dark" })).not.toThrow();
    expect(env.root.dataset["themeMode"]).toBe("dark");
  });
});
