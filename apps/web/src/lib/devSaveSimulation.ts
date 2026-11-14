/**
 * **开发构建里模拟慢保存 / 保存失败**（1.19.77，只给截图与逐帧核对用）。
 *
 * 保存成功转场要分别核对“很快成功”“比较慢”“失败”三种情况（所有者的验收清单），而本机写入几毫秒就完成、几乎不会失败。
 * 开发构建里可以在控制台或截图脚本里设：`window.__lvSaveDelay = 1500`（毫秒）、`window.__lvSaveFail = true`。
 * 正式构建里 `import.meta.env.DEV` 为 false，函数体整段被去掉，不存在这两个开关。
 */
export async function devSaveSimulation(): Promise<void> {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const flags = window as unknown as { __lvSaveDelay?: number; __lvSaveFail?: boolean };
  if (typeof flags.__lvSaveDelay === "number" && flags.__lvSaveDelay > 0) {
    const delay = flags.__lvSaveDelay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (flags.__lvSaveFail === true) throw new Error("模拟的保存失败（仅开发构建）");
}
