import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DUPLICATE_DETECTION_SETTINGS, type DuplicateDetectionSettings } from "@libellum/shared";

import { applyLocale } from "../i18n/index.js";
import { describeTimeWindowSeconds, parseCustomTimeWindowMinutes } from "../lib/duplicateSettings.js";
import {
  DuplicateDetectionSettingsSection,
  type DuplicateDetectionSettingsState,
} from "./DuplicateDetectionSettings.js";
import { SettingsToggle } from "./SettingsCard.js";

/**
 * 设置节的结构与文案。项目里的 Web 测试跑在纯 Node 环境（无 DOM），所以这里用
 * `renderToStaticMarkup` 检查“渲染出了什么控件、开关状态是什么、禁用时是否保留值”。
 * 交互细节（输入校验、存储）由纯函数测试覆盖。
 */

function settings(overrides: Partial<DuplicateDetectionSettings> = {}): DuplicateDetectionSettings {
  return { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, ...overrides };
}

function sectionHtml({
  value = settings(),
  state = {},
}: {
  readonly value?: DuplicateDetectionSettings;
  readonly state?: Partial<DuplicateDetectionSettingsState>;
} = {}): string {
  return renderToStaticMarkup(
    <DuplicateDetectionSettingsSection
      settings={value}
      saved={state.saved ?? false}
      error={state.error ?? null}
      notice={state.notice ?? null}
      onChange={state.update ?? (() => undefined)}
      onReset={state.reset ?? (() => undefined)}
    />,
  );
}

describe("重复交易检测设置节", () => {
  it("默认展示提醒、时间窗口、分类、支付方式与恢复默认", () => {
    const html = sectionHtml();

    expect(html).toContain("重复提醒");
    expect(html).toContain("时间窗口");
    expect(html).toContain("分类匹配");
    expect(html).toContain("支付方式匹配");
    expect(html).toContain("恢复默认设置");
    expect(html).toContain("关闭提醒不影响防止重复提交");
  });

  it("十个开关里默认开启金额、币种、方向、时间、分类与支付方式，时间窗口默认 1 分钟", () => {
    const html = sectionHtml();

    // 1 个总开关 + 7 个字段开关（金额/币种/方向/时间/商户/备注/标签）+ 分类 + 支付方式。
    expect((html.match(/role="switch"/g) ?? [])).toHaveLength(10);
    // 默认开启：总开关、金额、币种、方向、时间、分类、支付方式；商户/备注/标签默认关。
    expect((html.match(/aria-checked="true"/g) ?? [])).toHaveLength(7);
    expect((html.match(/aria-checked="false"/g) ?? [])).toHaveLength(3);
    expect(html).toContain("1 分钟");
    expect(html).not.toContain("当前窗口");
  });

  it("关闭提醒时规则区整体禁用，但原配置仍然保留", () => {
    const html = sectionHtml({
      value: settings({
        enabled: false,
        timeWindowSeconds: 300,
        matchCategory: false,
        matchPaymentMethod: false,
      }),
    });

    // fieldset 的 disabled 是原生禁用；开关的值仍在 DOM 里（分类/支付/三个可选字段为关）。
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain("5 分钟");
    expect(html).toContain("提醒已关闭，规则设置已保留");
    expect((html.match(/aria-checked="false"/g) ?? [])).toHaveLength(6);
  });

  it("自定义窗口显示当前值，并说明 1 分钟–30 天范围", () => {
    const html = sectionHtml({ value: settings({ timeWindowSeconds: 420 } ) });

    expect(html).toContain("自定义");
    expect(html).toContain("当前窗口：7 分钟");
    expect(html).toContain("1 分钟至 30 天");
  });

  it("保存成功、保存失败与恢复提示分别渲染", () => {
    expect(sectionHtml({ state: { saved: true } })).toContain("已保存。");

    const error = sectionHtml({ state: { error: "浏览器存储不可用，设置只在本次打开期间有效。" } });
    expect(error).toContain("浏览器存储不可用");

    const notice = sectionHtml({ state: { notice: "保存的重复检测设置无法读取，已使用默认值。" } });
    expect(notice).toContain("无法读取");
  });

  it("恢复默认按钮独立于 fieldset，提醒关闭时仍可用", () => {
    const html = sectionHtml({ value: settings({ enabled: false }) });
    const resetIndex = html.indexOf('data-testid="duplicate-settings-reset"');
    const fieldsetEnd = html.indexOf("</fieldset>");

    expect(resetIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(fieldsetEnd);
  });
});

describe("SettingsToggle", () => {
  it("使用 role=switch 与 aria-checked，点击回调收到相反值", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      <SettingsToggle label="分类匹配" checked={false} onChange={onChange} />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="分类匹配"');
    expect(html).toContain("分类匹配");

    /**
     * ⚠️ 静态标记里没有 DOM 事件，所以直接检查组件返回的元素树上的 `onClick`
     * ——与 `settingsHome.test.tsx` 检查币种按钮的方式一致。
     */
    const tree = SettingsToggle({ label: "分类匹配", checked: false, onChange }) as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    const button = onlyButton(tree);

    expect(button).toBeDefined();
    (button?.props as { onClick: () => void }).onClick();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("重复交易检测设置节（英文界面，S16）", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("开关、时间窗口与校验提示都是英文", () => {
    applyLocale("en-US");

    const html = sectionHtml({
      value: settings({ timeWindowSeconds: 7_200, enabled: false }),
      state: { saved: true },
    });

    expect(html).toContain("Duplicate alerts");
    expect(html).toContain("Match type (income/expense)");
    expect(html).toContain("Current window: 2 hours");
    expect(html).toContain("Restore defaults");
    expect(html).not.toMatch(/[㐀-鿿]/);

    expect(describeTimeWindowSeconds(60)).toBe("1 minute");
    expect(describeTimeWindowSeconds(172_800)).toBe("2 days");
    const parsed = parseCustomTimeWindowMinutes("1.5");
    expect(parsed.ok ? "" : parsed.message).not.toMatch(/[㐀-鿿]/);
  });
});

type Element = React.ReactElement<Record<string, unknown>>;

function elementsOf(node: React.ReactNode): Element[] {
  const found: Element[] = [];

  const walk = (current: React.ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (typeof current !== "object" || current === null) return;

    const element = current as Element;
    found.push(element);
    walk(element.props["children"] as React.ReactNode);
  };

  walk(node);

  return found;
}

function onlyButton(node: React.ReactNode): Element | undefined {
  return elementsOf(node).find((element) => element.type === "button");
}
