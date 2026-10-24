/**
 * 设置 → 记账偏好 → 重复交易检测（S15-E2）。
 *
 * ⚠️ **这是同一份设置的两个部分**：`useDuplicateDetectionSettings` 负责“存在哪里、
 * 按哪个用户隔离、怎么恢复”，本文件负责“怎么显示、怎么校验输入”。设置值只保留
 * 一份（hook 里的 `settings`），控件不各存一份。
 *
 * ⚠️ **关闭提醒只关闭业务层提示。** 控件全部保留（禁用而不是卸载），用户重新打开后
 * 原配置仍然在；幂等、来源去重、权限与离线同步不走这里，也不会被关闭。
 */

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  DUPLICATE_TIME_WINDOW_PRESETS_SECONDS,
  type DuplicateDetectionSettings,
} from "@libellum/shared";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import {
  describeTimeWindowSeconds,
  DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES,
  loadDuplicateSettings,
  parseCustomTimeWindowMinutes,
  saveDuplicateSettings,
  type DuplicateSettingsLoadResult,
  type DuplicateSettingsScope,
} from "../lib/duplicateSettings.js";
import { useGuestMode } from "../lib/guest/session.js";
import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
import { SettingsToggle } from "./SettingsCard.js";
import { InlineChoice } from "./ui/InlineChoice.js";

export interface DuplicateDetectionSettingsState {
  readonly settings: DuplicateDetectionSettings;
  /** 最近一次保存成功，显示「已保存。」。 */
  readonly saved: boolean;
  /** 最近一次保存失败，已经是可展示的中文。 */
  readonly error: string | null;
  /** 读取时发现旧版本/损坏/存储不可用；不是本次操作错误。 */
  readonly notice: string | null;
  update(patch: Partial<DuplicateDetectionSettings>): void;
  reset(): void;
}

function defaultLoadResult(): DuplicateSettingsLoadResult {
  return {
    settings: { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS },
    source: "default",
    issues: [],
    unknownFields: [],
    storageProblem: null,
  };
}

/**
 * 读取并保存当前身份的重复检测设置。
 *
 * ⚠️ **身份切换时重置页面内的临时值**：`scopeKey` 变化会清掉 `override`，避免把
 * A 账号刚改的值显示在 B 账号的设置页上。存储本身也是按用户 ID 分开的。
 */
export function useDuplicateDetectionSettings(): DuplicateDetectionSettingsState {
  const { user } = useAuth();
  const guest = useGuestMode();
  const userId = user?.id ?? null;

  const loaded = useMemo<DuplicateSettingsLoadResult>(() => {
    if (guest) return loadDuplicateSettings({ kind: "guest" });
    if (userId !== null) return loadDuplicateSettings({ kind: "account", userId });
    return defaultLoadResult();
  }, [guest, userId]);

  const scopeKey = guest ? "guest" : (userId ?? "none");

  const [override, setOverride] = useState<DuplicateDetectionSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverride(null);
    setSaved(false);
    setError(null);
  }, [scopeKey]);

  const settings = override ?? loaded.settings;

  const notice = useMemo<string | null>(() => {
    if (loaded.storageProblem === "unavailable") {
      return "浏览器存储不可用；这里的修改只在当前页面有效，刷新后会回到默认值。";
    }
    if (loaded.storageProblem === "unreadable") {
      return "保存的重复检测设置无法读取，已使用默认值。";
    }
    if (loaded.storageProblem === "version_mismatch") {
      return "保存的重复检测设置来自不同版本，已使用默认值。";
    }
    if (loaded.source === "recovered") {
      return "原有设置有一项无法读取，已对缺失或非法的项使用默认值。";
    }
    return null;
  }, [loaded]);

  const commit = (next: DuplicateDetectionSettings): void => {
    setOverride(next);
    setSaved(false);
    setError(null);

    const scope: DuplicateSettingsScope | null = guest
      ? { kind: "guest" }
      : userId !== null
        ? { kind: "account", userId }
        : null;

    if (scope === null) {
      setError("当前没有可保存设置的账号。");
      return;
    }

    const result = saveDuplicateSettings(scope, next);
    if (result.ok) setSaved(true);
    else setError(result.error);
  };

  return {
    settings,
    saved,
    error,
    notice,
    update: (patch) => {
      commit({ ...settings, ...patch });
    },
    reset: () => {
      commit({ ...DEFAULT_DUPLICATE_DETECTION_SETTINGS });
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function isPresetWindow(seconds: number): boolean {
  return (DUPLICATE_TIME_WINDOW_PRESETS_SECONDS as readonly number[]).includes(seconds);
}

/** 自定义输入框里显示“分钟”；不是整分钟时如实显示小数（提交会被校验拒绝）。 */
function minutesText(seconds: number): string {
  return String(seconds / 60);
}

const WINDOW_OPTIONS = [
  ...DUPLICATE_TIME_WINDOW_PRESETS_SECONDS.map((seconds) => ({
    id: String(seconds),
    label: describeTimeWindowSeconds(seconds),
  })),
  { id: "custom", label: "自定义", hint: "1 分钟–30 天" },
] as const;

export function DuplicateDetectionSettingsSection({
  settings,
  saved,
  error,
  notice,
  onChange,
  onReset,
}: {
  readonly settings: DuplicateDetectionSettings;
  readonly saved: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly onChange: (patch: Partial<DuplicateDetectionSettings>) => void;
  readonly onReset: () => void;
}): React.JSX.Element {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState(() => minutesText(settings.timeWindowSeconds));
  const [customError, setCustomError] = useState<string | null>(null);

  // 关闭提醒时把展开的选择器收起；重新开启后由用户自己决定是否展开。
  useEffect(() => {
    if (!settings.enabled) setChoiceOpen(false);
  }, [settings.enabled]);

  const preset = isPresetWindow(settings.timeWindowSeconds);
  const choiceValue = customOpen || !preset ? "custom" : String(settings.timeWindowSeconds);

  const selectWindow = (id: string): void => {
    setChoiceOpen(false);

    if (id === "custom") {
      setCustomOpen(true);
      setCustomText(minutesText(settings.timeWindowSeconds));
      setCustomError(null);
      return;
    }

    setCustomOpen(false);
    setCustomError(null);
    onChange({ timeWindowSeconds: Number(id) });
  };

  const applyCustom = (): void => {
    const parsed = parseCustomTimeWindowMinutes(customText);

    if (!parsed.ok) {
      setCustomError(parsed.message);
      return;
    }

    setCustomError(null);
    setCustomOpen(false);
    onChange({ timeWindowSeconds: parsed.seconds });
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsToggle
        label="重复提醒"
        hint="新增账目时提示疑似重复，不会自动删除或合并。"
        checked={settings.enabled}
        onChange={(enabled) => {
          onChange({ enabled });
        }}
        testId="duplicate-reminder-toggle"
      />

      {/**
       * ⚠️ **禁用，不是卸载。** `<fieldset disabled>` 会同时禁用里面的开关与选择器，
       * 但值仍在 DOM 里、仍由 `settings` 提供——重新开启时用户不需要重新设置一遍。
       */}
      <fieldset
        disabled={!settings.enabled}
        className={`m-0 flex min-w-0 flex-col gap-5 border-0 p-0 ${
          settings.enabled ? "" : "opacity-60"
        }`}
      >
        <legend className="sr-only">重复检测规则</legend>
        {([
          ["matchAmount", "金额匹配", true], ["matchCurrency", "币种匹配", true],
          ["matchKind", "收支方向匹配", true], ["matchTime", "时间匹配", true],
          ["matchMerchant", "商户匹配", false], ["matchNote", "备注匹配", false],
          ["matchTags", "标签匹配", false],
        ] as const).map(([key, label, fallback]) => <SettingsToggle key={key} label={label}
          checked={settings[key] ?? fallback} onChange={(value) => onChange({ [key]: value })} />)}
        {/**
         * ⚠️ S16-A：七个开关原来各自带同一句说明（"纳入此项判断；关闭后不会因为这一项不同而排除疑似
         * 重复。"），同一句话在一屏里出现七次。现在开关只写名称，这句说明在它们下面出现一次。
         */}
        <p className="text-helper-relaxed text-muted">
          仅比较已开启的项目，各账本独立检查。关闭多项规则可能增加疑似重复提醒。
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-card-title text-ink">时间窗口</span>
          <InlineChoice
            label="时间窗口"
            value={choiceValue}
            options={WINDOW_OPTIONS}
            open={settings.enabled && choiceOpen}
            testId="duplicate-window-choice"
            onToggle={() => {
              setChoiceOpen((open) => !open);
            }}
            onSelect={selectWindow}
            onClose={() => {
              setChoiceOpen(false);
            }}
          />
          <p className="text-helper-relaxed text-muted">
            仅比较时间相差不超过此范围的账目。默认 1 分钟，可设为 1 分钟至 30 天。
          </p>
          {!preset ? (
            <p className="text-helper text-muted">
              当前窗口：{describeTimeWindowSeconds(settings.timeWindowSeconds)}
            </p>
          ) : null}

          {settings.enabled && customOpen ? (
            <div className="flex flex-col gap-2 rounded-field bg-canvas p-3">
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-card-title text-ink">自定义（分钟）</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES}
                    step={1}
                    value={customText}
                    onChange={(event) => {
                      setCustomText(event.target.value);
                      setCustomError(null);
                    }}
                    className="min-h-11 w-full rounded-field border border-line bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth={false}
                  className="min-h-11"
                  onClick={applyCustom}
                >
                  应用
                </Button>
              </div>
              <p className="text-helper text-muted">
                请输入 1–{String(DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES)} 之间的整数分钟。
              </p>
              {customError === null ? null : (
                <p role="alert" className="text-helper-relaxed text-danger">
                  {customError}
                </p>
              )}
            </div>
          ) : null}
        </div>

        <SettingsToggle
          label="分类匹配"
          hint="双方都有分类时才要求一致；只有一方有分类不会因此被排除。"
          checked={settings.matchCategory}
          onChange={(matchCategory) => {
            onChange({ matchCategory });
          }}
          testId="duplicate-category-toggle"
        />

        <SettingsToggle
          label="支付方式匹配"
          hint="双方都有支付方式时才要求一致；只有一方有不会因此被排除。"
          checked={settings.matchPaymentMethod}
          onChange={(matchPaymentMethod) => {
            onChange({ matchPaymentMethod });
          }}
          testId="duplicate-payment-toggle"
        />
      </fieldset>

      {settings.enabled ? null : (
        <p className="text-helper-relaxed text-muted">
          提醒已关闭，规则设置已保留。
        </p>
      )}

      <p className="text-helper-relaxed text-muted">
        关闭提醒不影响防止重复提交、识别相同来源、权限检查和离线同步。
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {/**
         * 恢复默认放在 fieldset 外面：提醒关闭时也应该能一键恢复，否则用户要先打开提醒
         * 才能把其它设置恢复默认。
         */}
        <button
          type="button"
          data-testid="duplicate-settings-reset"
          onClick={onReset}
          className="inline-flex min-h-11 items-center text-link text-brand-dark transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          恢复默认设置
        </button>
        {saved ? <span className="text-helper text-brand-dark">已保存。</span> : null}
      </div>

      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="info">{notice}</Alert>}
    </div>
  );
}

/** 设置页卡片：把 hook 的状态交给纯展示组件。 */
export function DuplicateDetectionSettingsCard(): React.JSX.Element {
  const state = useDuplicateDetectionSettings();

  return (
    <DuplicateDetectionSettingsSection
      settings={state.settings}
      saved={state.saved}
      error={state.error}
      notice={state.notice}
      onChange={state.update}
      onReset={state.reset}
    />
  );
}
