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
        lineCount: 2,
        averageConfidence: 0.9,
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

  it("honours the per-image timeout after a successful startup", async () => {
    const script = await fixture(READY + "process.stdin.resume();");
    const client = service(script, { recognizeTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.recognize(Buffer.from("synthetic"), 0)).rejects.toThrow(/识别超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
