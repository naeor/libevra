import { describe, expect, it } from "vitest";
import { enterModeOptions } from "./enterMode.js";
describe("工作模式时间预算", () => {
  it("默认140ms直接揭示，两种候选共用三档短预算", () => {
    expect(enterModeOptions("")).toEqual({ duration: 140, fade: false });
    for (const duration of [110, 140, 160]) expect(enterModeOptions(`?enterMs=${duration}&enterFade=1`)).toEqual({ duration, fade: true });
    expect(enterModeOptions("?enterMs=900&enterFade=invalid")).toEqual({ duration: 140, fade: false });
  });
});
