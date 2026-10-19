import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VoiceService, VoiceServiceError } from "../src/voice/client.js";

/**
 * The child-process lifecycle, without Python or Whisper.
 *
 * These tests pin down the failures that used to wait for the old 300/600-second
 * timers: a child that exits before ready must reject immediately, and the next
 * request must be able to start a fresh child.
 */
const services: VoiceService[] = [];
const directories: string[] = [];

async function fixture(program: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "libevra-voice-client-"));
  directories.push(directory);
  const script = path.join(directory, "fake-service.py");
  await writeFile(script, program, "utf8");
  return script;
}

function service(script: string, options: { startupTimeoutMs?: number; transcribeTimeoutMs?: number } = {}): VoiceService {
  const instance = new VoiceService({
    pythonPath: process.execPath,
    serviceDirectory: path.dirname(script),
    serviceFile: script,
    startupTimeoutMs: options.startupTimeoutMs ?? 2_000,
    transcribeTimeoutMs: options.transcribeTimeoutMs ?? 2_000,
  });
  services.push(instance);
  return instance;
}

const LOADING = "process.stdout.write(JSON.stringify({ready:false,loading:true})+\"\\n\");";
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
        text: "午餐三十五元，用微信支付。",
        seconds: 0.01,
        audioSeconds: 4.7,
        timings: { decodeMs: 5, vadMs: 2, inferMs: 10, totalMs: 17 },
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

afterEach(async () => {
  for (const instance of services.splice(0)) instance.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("VoiceService child lifecycle", () => {
  it("fails fast when the child exits before ready", async () => {
    const script = await fixture("process.exit(7);");
    const client = service(script, { startupTimeoutMs: 5_000 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toBeInstanceOf(VoiceServiceError);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("reports a missing interpreter as a startup failure", async () => {
    const client = new VoiceService({
      pythonPath: path.join(tmpdir(), "libevra-missing-python", "python"),
      serviceDirectory: tmpdir(),
      serviceFile: "service.py",
      startupTimeoutMs: 1_000,
    });
    services.push(client);
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/找不到语音识别/);
  });

  it("starts normally and returns a transcription with timing", async () => {
    const script = await fixture(LOADING + ANSWER);
    const client = service(script);
    const result = await client.transcribe(Buffer.from("synthetic"));
    expect(result.text).toContain("午餐");
    expect(result.audioSeconds).toBe(4.7);
    expect(result.timings).toMatchObject({ decodeMs: 5, vadMs: 2, inferMs: 10 });
  });

  it("honours the startup timeout when the child never becomes ready", async () => {
    const script = await fixture("process.stdin.resume();");
    const client = service(script, { startupTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/启动超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("recovers after the child is fixed", async () => {
    const script = await fixture("process.exit(3);");
    const client = service(script);
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toBeInstanceOf(VoiceServiceError);

    await writeFile(script, LOADING + ANSWER, "utf8");
    const result = await client.transcribe(Buffer.from("synthetic"));
    expect(result.text).toContain("午餐");
  });

  it("honours the per-recording timeout after a successful startup", async () => {
    const script = await fixture(LOADING + "process.stdin.resume();");
    const client = service(script, { transcribeTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/识别超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
