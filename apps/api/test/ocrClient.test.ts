import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OcrService, OcrServiceError } from "../src/ocr/client.js";

/**
 * The child-process lifecycle, without Python or OCR models.
 *
 * A missing shared library makes Python exit before printing `{"ready":true}`. The old client
 * waited for its 60-second startup timer even though the child was already gone; these tests pin
 * down the fast failure and the ability to retry after the environment is fixed.
 */
const services: OcrService[] = [];
const directories: string[] = [];

async function fixture(program: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "libevra-ocr-client-"));
  directories.push(directory);
  const script = path.join(directory, "fake-service.py");
  await writeFile(script, program, "utf8");
  return script;
}

function service(script: string, options: { startupTimeoutMs?: number; recognizeTimeoutMs?: number } = {}): OcrService {
  const instance = new OcrService({
    pythonPath: process.execPath,
    serviceDirectory: path.dirname(script),
    serviceFile: script,
    startupTimeoutMs: options.startupTimeoutMs ?? 2_000,
    recognizeTimeoutMs: options.recognizeTimeoutMs ?? 2_000,
  });
  services.push(instance);
  return instance;
}

const READY = "process.stdout.write(JSON.stringify({ready:true})+\"\\n\");";
const ANSWER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        id: request.id,
        ok: true,
        draft: { amount: "12.34", currency: "CNY", occurred_local_date: "2026-02-01", kind: "expense" },
        page_type: "transaction-list",
        layout_label: "微信交易列表",
        requires_user_choice: false,
        warnings: ["一页多笔"],
        candidates: [{
          candidate_id: "img" + request.image_index + "-1",
          image_index: request.image_index,
          amount: "12.34",
          currency: "CNY",
          direction: "expense",
          occurred_local_date: "2026-02-01",
          occurred_time: "09:15",
          merchant: "早餐店",
          source_platform: "WECHAT",
          account: "零钱",
          note: null,
          status: "posted",
          is_refund: false,
          is_transfer: false,
          serial: null,
          issues: [{ code: "missing_time", message: "没有读出时间", field: "time" }],
          duplicate_suspected: false,
          duplicate_group_ids: [],
          is_complete: true,
          is_questionable: false,
          raw_text: "早餐店\\n-12.34"
        }],
        lineCount: 2,
        averageConfidence: 0.9,
        seconds: 0.01,
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/**
 * The 2026-10-21 order platforms.
 *
 * The Python recogniser prints `MEITUAN` / `JD` / `TAOBAO`; the client used to
 * whitelist only the three payment channels and turn these into null. This fake
 * also echoes one value the enum does not know, because filtering an unknown
 * string must keep working.
 */
const ORDER_ANSWER = `
let buffer = "";
const platforms = ["MEITUAN", "JD", "TAOBAO", "FUTURE_PLATFORM"];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const request = JSON.parse(line);
      const platform = platforms[request.image_index] ?? "FUTURE_PLATFORM";
      process.stdout.write(JSON.stringify({
        id: request.id,
        ok: true,
        draft: {
          amount: "12.34",
          currency: "CNY",
          occurred_local_date: "2026-02-01",
          kind: "expense",
          channel: platform,
        },
        page_type: "transaction-list",
        layout_label: "订单列表",
        requires_user_choice: false,
        warnings: [],
        candidates: [{
          candidate_id: "img" + request.image_index + "-1",
          image_index: request.image_index,
          amount: "12.34",
          currency: "CNY",
          direction: "expense",
          occurred_local_date: "2026-02-01",
          occurred_time: null,
          merchant: "示例商户",
          source_platform: platform,
          account: null,
          note: null,
          status: "posted",
          is_refund: false,
          is_transfer: false,
          serial: null,
          issues: [],
          duplicate_suspected: false,
          duplicate_group_ids: [],
          is_complete: true,
          is_questionable: false,
          raw_text: "示例商户\\n-12.34"
        }],
        lineCount: 2,
        averageConfidence: 0.9,
        seconds: 0.01,
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** A response from a recogniser that has not been updated for S15-B. */
const LEGACY_ANSWER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        id: request.id,
        ok: true,
        draft: { amount: "7.00", currency: "CNY", occurred_local_date: "2026-02-02", kind: "expense" },
        lineCount: 1,
        averageConfidence: 0.8,
        seconds: 0.01,
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

afterEach(async () => {
  for (const instance of services.splice(0)) instance.stop();
  // On Windows `kill()` is asynchronous; waiting briefly keeps the temp script
  // from being locked while it is being removed.
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("OcrService child lifecycle", () => {
  it("fails fast when the child exits before ready", async () => {
    const script = await fixture("process.exit(7);");
    const client = service(script, { startupTimeoutMs: 5_000 });
    const started = Date.now();
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toBeInstanceOf(OcrServiceError);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("reports a missing interpreter as a startup failure", async () => {
    const client = new OcrService({
      pythonPath: path.join(tmpdir(), "libevra-missing-python", "python"),
      serviceDirectory: tmpdir(),
      serviceFile: "service.py",
      startupTimeoutMs: 1_000,
    });
    services.push(client);
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toThrow(/找不到 OCR/);
  });

  it("starts normally and returns a draft", async () => {
    const script = await fixture(READY + ANSWER);
    const client = service(script);
    const item = await client.recognize(Buffer.from("synthetic"), 3);
    expect(item).toMatchObject({ ok: true, index: 3, lineCount: 2 });
    expect(item.draft?.amount).toBe("12.34");
    expect(item.draft?.occurredLocalDate).toBe("2026-02-01");
  });

  it("honours the startup timeout when the child never becomes ready", async () => {
    const script = await fixture("process.stdin.resume();");
    const client = service(script, { startupTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toThrow(/启动超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("recovers after the child is fixed", async () => {
    const script = await fixture("process.exit(3);");
    const client = service(script);
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toBeInstanceOf(OcrServiceError);

    await writeFile(script, READY + ANSWER, "utf8");
    const item = await client.recognize(Buffer.from("synthetic"), 0);
    expect(item.ok).toBe(true);
    expect(item.draft?.amount).toBe("12.34");
  });

  it("maps the page type, candidates and their issues", async () => {
    const script = await fixture(READY + ANSWER);
    const client = service(script);
    const item = await client.recognize(Buffer.from("synthetic"), 2);

    expect(item.pageType).toBe("transaction-list");
    expect(item.layoutLabel).toBe("微信交易列表");
    expect(item.requiresUserChoice).toBe(false);
    expect(item.warnings).toEqual(["一页多笔"]);
    expect(item.candidates).toHaveLength(1);
    expect(item.candidates[0]).toMatchObject({
      candidateId: "img2-1",
      imageIndex: 2,
      amount: "12.34",
      currency: "CNY",
      direction: "expense",
      merchant: "早餐店",
      sourcePlatform: "WECHAT",
      status: "posted",
      isComplete: true,
      isQuestionable: false,
    });
    expect(item.candidates[0]?.issues[0]).toEqual({
      code: "missing_time",
      message: "没有读出时间",
      field: "time",
    });
  });

  it("keeps a pre-S15-B response working (no page type, no candidates)", async () => {
    const script = await fixture(READY + LEGACY_ANSWER);
    const client = service(script);
    const item = await client.recognize(Buffer.from("synthetic"), 0);

    expect(item.ok).toBe(true);
    expect(item.draft?.amount).toBe("7.00");
    expect(item.pageType).toBeNull();
    expect(item.candidates).toEqual([]);
    expect(item.warnings).toEqual([]);
    expect(item.requiresUserChoice).toBe(false);
  });

  it("passes the order platforms through and still filters unknown channels", async () => {
    const script = await fixture(READY + ORDER_ANSWER);
    const client = service(script);

    for (const [index, platform] of (["MEITUAN", "JD", "TAOBAO"] as const).entries()) {
      const item = await client.recognize(Buffer.from("synthetic"), index);
      expect(item.candidates[0]?.sourcePlatform).toBe(platform);
      expect(item.draft?.channel).toBe(platform);
    }

    // A value the shared enum does not know is null, never a raw string.
    const unknown = await client.recognize(Buffer.from("synthetic"), 3);
    expect(unknown.candidates[0]?.sourcePlatform).toBeNull();
    expect(unknown.draft?.channel).toBeNull();
  });

  it("honours the per-image timeout after a successful startup", async () => {
    const script = await fixture(READY + "process.stdin.resume();");
    const client = service(script, { recognizeTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toThrow(/识别超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
