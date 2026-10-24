import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INVITE_REJECTION_CODE, normalizeNotDuplicatePair } from "@libellum/shared";
import { afterEach, describe, expect, it } from "vitest";

import { ApiRequestError, localizedApiErrorMessage } from "../lib/api.js";
import { applyLocale } from "./index.js";
import { enUS, zhCN } from "./resources/index.js";

/**
 * S16：服务器错误码 → `errors.api.<code>` 的覆盖检查。
 *
 * 英文界面按**错误码**显示文案（`lib/api.ts` 的 `localizedApiErrorMessage`）；没有收录的错误码只能
 * 显示一句通用说明。这里直接扫描服务器源码收集错误码，**新增错误码却忘了写译文会让测试失败**，
 * 不会悄悄退回通用说明。
 *
 * 收集来源：
 * 1. `apps/api/src` 里 `badRequest` / `conflict` / … 与 `new AppError` / `BillParseError` /
 *    `DocumentExtractError` / `TranscriptionRejected` 的第一个参数（含 `a ? "x" : "y"`、`b ?? "z"`
 *    这类条件写法）；
 * 2. `lib/errors.ts` 里直接写进响应体的 `code: "…"`；
 * 3. 子进程透传的错误码：账单解析脚本的 `ALLOWED`、语音识别服务的 `MESSAGES` 与 `"error": "…"`；
 * 4. shared 里由映射表 / 函数决定的错误码（邀请码拒绝原因、不重复配对校验）。
 */

const API_SRC = fileURLToPath(new URL("../../../api/src/", import.meta.url));
const VOICE_SERVICE = fileURLToPath(new URL("../../../voice/service.py", import.meta.url));

const HELPERS = "badRequest|unauthorized|forbidden|conflict|notFound|gone|tooManyRequests|serviceUnavailable";
const ERROR_CLASSES = "AppError|BillParseError|DocumentExtractError|TranscriptionRejected";

/** 第一个参数（不含逗号与括号，足以覆盖字面量、三元与 `??`）。 */
const FIRST_ARGUMENT = new RegExp(
  `(?:\\b(?:${HELPERS})|\\bnew\\s+(?:${ERROR_CLASSES}))\\(\\s*(?:\\d+\\s*,\\s*)?([^,()]*?)\\s*,`,
  "g",
);
/** 参数里作为“值”出现的字面量：开头、`?` 或 `:` 之后（排除 `x === "y"` 里被比较的那一个）。 */
const CODE_LITERAL = /(?:^|[?:])\s*"([A-Za-z0-9_]+)"/g;
/** 错误处理器直接写进响应体的错误码。 */
const PAYLOAD_CODE = /\bcode:\s*(?:[\w.]+\s*\?\?\s*)?"([A-Za-z0-9_]+)"/g;

/**
 * Fastify 框架及其插件自己产生的错误码。源码里没有，但会经 `lib/errors.ts` 的兜底分支原样返回，
 * 所以 `errors.api` 里另外收录了这几条。
 */
const FRAMEWORK_CODES = [
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_INVALID_MULTIPART_CONTENT_TYPE",
  "FST_REQ_FILE_TOO_LARGE",
  "FST_FILES_LIMIT",
  "FST_PARTS_LIMIT",
  "FST_FIELDS_LIMIT",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"))
    .map((name) => path.join(directory, name));
}

function collectServerErrorCodes(): Set<string> {
  const codes = new Set<string>();

  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(FIRST_ARGUMENT)) {
      for (const literal of (call[1] ?? "").matchAll(CODE_LITERAL)) codes.add(literal[1]!);
    }
    if (path.basename(file) === "errors.ts" && path.basename(path.dirname(file)) === "lib") {
      for (const payload of text.matchAll(PAYLOAD_CODE)) codes.add(payload[1]!);
    }
  }

  // 账单解析脚本：只允许白名单里的错误码透传给浏览器。
  const extractor = readFileSync(path.join(API_SRC, "import", "extract_document.py"), "utf8");
  const allowed = /ALLOWED\s*=\s*\{([^}]*)\}/.exec(extractor)?.[1] ?? "";
  for (const literal of allowed.matchAll(/"([a-z0-9_]+)"/g)) codes.add(literal[1]!);

  // 语音识别服务：拒绝原因 = MESSAGES 的键，以及直接写出的 `"error": "…"`。
  const voice = readFileSync(VOICE_SERVICE, "utf8");
  const messages = /^MESSAGES\s*=\s*\{([\s\S]*?)^\}/m.exec(voice)?.[1] ?? "";
  for (const key of messages.matchAll(/^\s*"([a-z0-9_]+)"\s*:/gm)) codes.add(key[1]!);
  for (const literal of voice.matchAll(/"error":\s*"([a-z0-9_]+)"/g)) codes.add(literal[1]!);

  // shared：邀请码拒绝原因、不重复配对校验。
  for (const code of Object.values(INVITE_REJECTION_CODE)) codes.add(code);
  for (const [a, b] of [["", "x"], ["same", "same"]] as const) {
    const result = normalizeNotDuplicatePair(a, b);
    if (!result.ok) codes.add(result.error.code);
  }

  return codes;
}

const serverCodes = collectServerErrorCodes();
const zhApi = zhCN.errors.api as Readonly<Record<string, string>>;
const enApi = enUS.errors.api as Readonly<Record<string, string>>;

afterEach(() => {
  applyLocale("zh-CN");
});

describe("服务器错误码的译文", () => {
  it("扫描本身是有效的（防止正则失效后测试空转）", () => {
    expect(serverCodes.size).toBeGreaterThan(200);
    for (const known of [
      "auth_required",
      "validation_failed",
      "notification_quota_total",
      "transcribe_failed",
      "python_unavailable",
      "scanned_pdf",
      "audio_not_base64",
      "invite_expired",
      "same_transaction",
      "internal_error",
      "request_error",
    ]) {
      expect(serverCodes, known).toContain(known);
    }
    // 被比较的值不是错误码。
    expect(serverCodes).not.toContain("per_subject");
    expect(serverCodes).not.toContain("ENOENT");
  });

  it("服务器可能返回的每个错误码都有中英文", () => {
    const missingZh = [...serverCodes].filter((code) => !(code in zhApi)).sort();
    const missingEn = [...serverCodes].filter((code) => !(code in enApi)).sort();
    expect(missingZh).toEqual([]);
    expect(missingEn).toEqual([]);
  });

  it("没有多余的错误码（拼错或服务器已删除的条目）", () => {
    const known = new Set<string>([...serverCodes, ...FRAMEWORK_CODES]);
    expect(Object.keys(zhApi).filter((code) => !known.has(code)).sort()).toEqual([]);
  });

  it("英文按错误码显示，中文界面仍显示服务器原文", () => {
    const error = new ApiRequestError(409, "username_taken", "该用户名已被占用。");
    expect(localizedApiErrorMessage(error)).toBe("该用户名已被占用。");
    applyLocale("en-US");
    expect(localizedApiErrorMessage(error)).toBe("That username is already taken.");
  });

  it("带变量的服务器原文在英文界面也得到完整句子", () => {
    applyLocale("en-US");
    const throttled = new ApiRequestError(429, "password_throttled", "密码尝试次数过多，请 37 秒后再试。");
    expect(localizedApiErrorMessage(throttled)).toBe(enApi["password_throttled"]);
    const framework = new ApiRequestError(413, "FST_REQ_FILE_TOO_LARGE", "request file too large");
    expect(localizedApiErrorMessage(framework)).toBe("The uploaded file is too large.");
  });

  it("英文错误文案不含插值占位符（服务器不会传变量）", () => {
    expect(Object.entries(enApi).filter(([, text]) => /\{\{/.test(text))).toEqual([]);
  });
});
