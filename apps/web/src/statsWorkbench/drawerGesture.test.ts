import { describe, expect, it } from "vitest";

import { releaseTarget } from "./drawerGesture.js";

/** 展开 / 收起之间 300px；慢拖用 2 秒（远低于「一甩」的速度门槛）。 */
const TRAVEL = 300;
const SLOW = 2000;
const FAST = 120;

describe("底部工具栏手势：松手吸附", () => {
  it("从展开往下慢慢拖：过半收起，不过半回到展开", () => {
    expect(releaseTarget(1, 200, SLOW, TRAVEL).end).toBe("collapsed");
    expect(releaseTarget(1, 120, SLOW, TRAVEL).end).toBe("expanded");
  });

  it("从收起往上慢慢拖：过半展开，不过半回到收起", () => {
    expect(releaseTarget(0, -200, SLOW, TRAVEL).end).toBe("expanded");
    expect(releaseTarget(0, -100, SLOW, TRAVEL).end).toBe("collapsed");
  });

  it("快速一甩看方向，不看距离", () => {
    expect(releaseTarget(0, -60, FAST, TRAVEL).end).toBe("expanded");
    expect(releaseTarget(1, 60, FAST, TRAVEL).end).toBe("collapsed");
  });

  it("进度按手指位置跟随并夹在两端之间", () => {
    expect(releaseTarget(1, 150, SLOW, TRAVEL).progress).toBeCloseTo(0.5);
    expect(releaseTarget(0, -900, SLOW, TRAVEL).progress).toBe(1);
    expect(releaseTarget(1, 900, SLOW, TRAVEL).progress).toBe(0);
  });

  it("没有移动的按下-抬起保持原状态（点击交给按钮处理）", () => {
    expect(releaseTarget(1, 0, 80, TRAVEL).end).toBe("expanded");
    expect(releaseTarget(0, 0, 80, TRAVEL).end).toBe("collapsed");
  });
});
