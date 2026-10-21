import { describe, expect, it, vi } from "vitest";

import { DEFAULT_DUPLICATE_DETECTION_SETTINGS, type DuplicateDetectionSettings } from "@libellum/shared";

import {
  DUPLICATE_SETTINGS_SCHEMA_VERSION,
  DUPLICATE_SETTINGS_STORAGE_PREFIX,
  clearDuplicateSettings,
  clearGuestDuplicateSettings,
  describeTimeWindowSeconds,
  duplicateSettingsStorageKey,
  loadDuplicateSettings,
  parseCustomTimeWindowMinutes,
  saveDuplicateSettings,
  type DuplicateSettingsScope,
  type DuplicateSettingsStorage,
} from "./duplicateSettings.js";

/**
 * 设备本地设置：隔离、版本、损坏恢复与游客清理。
 *
 * ⚠️ 这些测试**不读真实 localStorage**：注入内存实现，所以在无 DOM 的 Node 测试
 * 环境里也能覆盖“账号切换”“登出后保留”“游客清理只删游客键”等行为。
 */

const ACCOUNT_A: DuplicateSettingsScope = { kind: "account", userId: "user-a" };
const ACCOUNT_B: DuplicateSettingsScope = { kind: "account", userId: "user-b" };
const GUEST: DuplicateSettingsScope = { kind: "guest" };

function memoryStorage(): DuplicateSettingsStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();

  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function custom(overrides: Partial<DuplicateDetectionSettings> = {}): DuplicateDetectionSettings {
  return { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, ...overrides };
}

function storedRecord(settings: DuplicateDetectionSettings): string {
  return JSON.stringify({
    version: DUPLICATE_SETTINGS_SCHEMA_VERSION,
    settings,
    updatedAt: "2026-10-21T10:00:00.000Z",
  });
}

describe("存储键与账号隔离", () => {
  it("正式账号按用户 ID 隔离，游客使用单独槽位", () => {
    const keyA = duplicateSettingsStorageKey(ACCOUNT_A);
    const keyB = duplicateSettingsStorageKey(ACCOUNT_B);

    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith(DUPLICATE_SETTINGS_STORAGE_PREFIX)).toBe(true);
    expect(keyA).toContain("user-a");
    expect(duplicateSettingsStorageKey(GUEST)).toBe(`${DUPLICATE_SETTINGS_STORAGE_PREFIX}.guest`);
  });

  it("用户 ID 中的特殊字符被编码，不会串到另一个键", () => {
    const key = duplicateSettingsStorageKey({ kind: "account", userId: "a/b?c#d" });

    expect(key).not.toContain("?");
    expect(key).not.toContain("#");
    expect(key).toContain(encodeURIComponent("a/b?c#d"));
  });

  it("所有键都以 libellum 开头，clearAllDeviceData 的清理扫描会覆盖它们", () => {
    // `lib/guest/cleanup.ts` 的“清除本机全部数据”按 `libellum` 前缀扫描 localStorage。
    expect(duplicateSettingsStorageKey(ACCOUNT_A).startsWith("libellum")).toBe(true);
    expect(duplicateSettingsStorageKey(GUEST).startsWith("libellum")).toBe(true);
  });

  it("A 账号保存的设置不会被 B 账号读到", () => {
    const storage = memoryStorage();

    expect(saveDuplicateSettings(ACCOUNT_A, custom({ timeWindowSeconds: 300 }), storage).ok).toBe(
      true,
    );
    expect(loadDuplicateSettings(ACCOUNT_A, storage).settings.timeWindowSeconds).toBe(300);
    expect(loadDuplicateSettings(ACCOUNT_B, storage)).toMatchObject({
      source: "default",
      settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS,
    });
  });

  it("账号切换只切换作用域，不把一个账号的值写成另一个账号的默认值", () => {
    const storage = memoryStorage();
    saveDuplicateSettings(ACCOUNT_A, custom({ matchCategory: false }), storage);

    const loadedB = loadDuplicateSettings(ACCOUNT_B, storage);
    expect(loadedB.settings.matchCategory).toBe(true);
    expect(storage.values.has(duplicateSettingsStorageKey(ACCOUNT_B))).toBe(false);
  });
});

describe("保存与读取", () => {
  it("保存后原样读回，记录带版本号", () => {
    const storage = memoryStorage();
    const settings = custom({
      enabled: false,
      timeWindowSeconds: 1_800,
      matchCategory: false,
      matchPaymentMethod: false,
    });

    expect(saveDuplicateSettings(ACCOUNT_A, settings, storage)).toEqual({ ok: true, error: null });

    const raw = JSON.parse(storage.values.get(duplicateSettingsStorageKey(ACCOUNT_A)) ?? "{}") as {
      version?: unknown;
    };
    expect(raw.version).toBe(DUPLICATE_SETTINGS_SCHEMA_VERSION);
    expect(loadDuplicateSettings(ACCOUNT_A, storage)).toMatchObject({
      source: "stored",
      settings,
      issues: [],
      unknownFields: [],
      storageProblem: null,
    });
  });

  it("保存前严格校验：非法设置不会写入", () => {
    const storage = memoryStorage();
    const result = saveDuplicateSettings(
      ACCOUNT_A,
      custom({ timeWindowSeconds: Number.NaN }),
      storage,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("设置不合法");
    expect(storage.values.size).toBe(0);
  });

  it("存储不可用时读取默认值、保存返回明确错误", () => {
    expect(loadDuplicateSettings(ACCOUNT_A, null)).toMatchObject({
      source: "default",
      settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      storageProblem: "unavailable",
    });
    expect(saveDuplicateSettings(ACCOUNT_A, custom(), null)).toMatchObject({
      ok: false,
    });
  });

  it("写入抛异常（配额/隐私模式）时返回错误，不抛裸异常", () => {
    const storage: DuplicateSettingsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };

    const result = saveDuplicateSettings(ACCOUNT_A, custom(), storage);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("写入失败");
  });
});

describe("损坏、旧版本与未知字段", () => {
  it("JSON 损坏 → 默认值并报告 unreadable", () => {
    const storage = memoryStorage();
    storage.setItem(duplicateSettingsStorageKey(ACCOUNT_A), "{not json");

    expect(loadDuplicateSettings(ACCOUNT_A, storage)).toMatchObject({
      source: "default",
      settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      storageProblem: "unreadable",
    });
  });

  it("版本不认识 → 默认值并报告 version_mismatch，不猜测旧格式", () => {
    const storage = memoryStorage();
    storage.setItem(
      duplicateSettingsStorageKey(ACCOUNT_A),
      JSON.stringify({ version: 99, settings: custom({ timeWindowSeconds: 300 }) }),
    );

    expect(loadDuplicateSettings(ACCOUNT_A, storage)).toMatchObject({
      source: "default",
      settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      storageProblem: "version_mismatch",
    });
  });

  it("部分字段非法 → 合法字段保留、非法字段回落默认并报告", () => {
    const storage = memoryStorage();
    storage.setItem(
      duplicateSettingsStorageKey(ACCOUNT_A),
      storedRecord(custom({ enabled: false, timeWindowSeconds: -5 })),
    );

    const loaded = loadDuplicateSettings(ACCOUNT_A, storage);

    expect(loaded.source).toBe("recovered");
    expect(loaded.settings.enabled).toBe(false);
    expect(loaded.settings.timeWindowSeconds).toBe(60);
    expect(loaded.issues.map((issue) => issue.code)).toContain("below_minimum");
  });

  it("未知字段被忽略并报告，不影响可用字段", () => {
    const storage = memoryStorage();
    storage.setItem(
      duplicateSettingsStorageKey(ACCOUNT_A),
      JSON.stringify({
        version: 1,
        settings: { ...custom(), futureField: true },
        updatedAt: "2026-10-21T10:00:00.000Z",
      }),
    );

    const loaded = loadDuplicateSettings(ACCOUNT_A, storage);

    expect(loaded.source).toBe("recovered");
    expect(loaded.unknownFields).toEqual(["futureField"]);
    expect(loaded.settings).toEqual(DEFAULT_DUPLICATE_DETECTION_SETTINGS);
  });

  it("设置字段整体缺失 → 全部默认并报告", () => {
    const storage = memoryStorage();
    storage.setItem(
      duplicateSettingsStorageKey(ACCOUNT_A),
      JSON.stringify({ version: 1, updatedAt: "2026-10-21T10:00:00.000Z" }),
    );

    const loaded = loadDuplicateSettings(ACCOUNT_A, storage);

    expect(loaded.source).toBe("recovered");
    expect(loaded.settings).toEqual(DEFAULT_DUPLICATE_DETECTION_SETTINGS);
    expect(loaded.issues.map((issue) => issue.code)).toContain("not_object");
  });
});

describe("登出与游客清理", () => {
  it("登出不会自动删除账号设置：重新登录仍能读到（设备本地）", () => {
    const storage = memoryStorage();
    saveDuplicateSettings(ACCOUNT_A, custom({ timeWindowSeconds: 300 }), storage);

    // 登出只结束会话；本模块没有“登出即清理”的调用。
    expect(loadDuplicateSettings(ACCOUNT_A, storage).settings.timeWindowSeconds).toBe(300);
  });

  it("游客清理只删游客槽位，正式账号设置保持不变", () => {
    const storage = memoryStorage();
    saveDuplicateSettings(ACCOUNT_A, custom({ timeWindowSeconds: 300 }), storage);
    saveDuplicateSettings(GUEST, custom({ matchPaymentMethod: false }), storage);

    expect(clearGuestDuplicateSettings(storage)).toBe(true);

    expect(storage.values.has(duplicateSettingsStorageKey(GUEST))).toBe(false);
    expect(loadDuplicateSettings(ACCOUNT_A, storage).settings.timeWindowSeconds).toBe(300);
  });

  it("clearDuplicateSettings 只删指定作用域", () => {
    const storage = memoryStorage();
    saveDuplicateSettings(ACCOUNT_A, custom(), storage);
    saveDuplicateSettings(ACCOUNT_B, custom({ matchCategory: false }), storage);

    expect(clearDuplicateSettings(ACCOUNT_A, storage)).toBe(true);

    expect(loadDuplicateSettings(ACCOUNT_A, storage).source).toBe("default");
    expect(loadDuplicateSettings(ACCOUNT_B, storage).settings.matchCategory).toBe(false);
  });

  it("存储不可用时清理返回 false，不抛异常", () => {
    expect(clearGuestDuplicateSettings(null)).toBe(false);
    expect(clearDuplicateSettings(ACCOUNT_A, null)).toBe(false);
  });
});

describe("自定义时间窗口输入", () => {
  it("接受 1–43200 的整数分钟并换算为秒", () => {
    expect(parseCustomTimeWindowMinutes("1")).toEqual({ ok: true, seconds: 60 });
    expect(parseCustomTimeWindowMinutes(" 5 ")).toEqual({ ok: true, seconds: 300 });
    expect(parseCustomTimeWindowMinutes("43200")).toEqual({ ok: true, seconds: 2_592_000 });
  });

  it("拒绝空值、负数、小数、NaN/Infinity、科学计数法与超上限", () => {
    const invalid = ["", "  ", "0", "-5", "1.5", "NaN", "Infinity", "1e3", "abc", "43201"];

    for (const input of invalid) {
      const result = parseCustomTimeWindowMinutes(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) expect(result.message.length, input).toBeGreaterThan(0);
    }
  });

  it("错误信息说明范围", () => {
    const below = parseCustomTimeWindowMinutes("0");
    const above = parseCustomTimeWindowMinutes("43201");

    expect(below.ok ? "" : below.message).toContain("1 分钟");
    expect(above.ok ? "" : above.message).toContain("30 天");
  });
});

describe("时间窗口的人类可读描述", () => {
  it("整日/整小时/整分钟/秒分别说明", () => {
    expect(describeTimeWindowSeconds(86_400)).toBe("1 天");
    expect(describeTimeWindowSeconds(172_800)).toBe("2 天");
    expect(describeTimeWindowSeconds(3_600)).toBe("1 小时");
    expect(describeTimeWindowSeconds(300)).toBe("5 分钟");
    expect(describeTimeWindowSeconds(90)).toBe("90 秒");
  });
});

describe("localStorage 真实接口形状", () => {
  it("传入的存储只需 getItem/setItem/removeItem 三个方法", () => {
    const spy = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(loadDuplicateSettings(ACCOUNT_A, spy).source).toBe("default");
    expect(saveDuplicateSettings(ACCOUNT_A, custom(), spy).ok).toBe(true);
    expect(clearDuplicateSettings(ACCOUNT_A, spy)).toBe(true);

    expect(spy.setItem).toHaveBeenCalledTimes(1);
    expect(spy.removeItem).toHaveBeenCalledTimes(1);
  });
});
