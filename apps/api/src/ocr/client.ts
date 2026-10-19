import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { OcrChannel, OcrDraft, OcrItemResult } from "@libellum/shared";

/**
 * Talks to the Python recogniser.
 *
 * The recogniser runs as one long-lived process, because loading its models
 * takes about two seconds and paying that per screenshot would triple the time
 * the user waits. Communication is one JSON object per line over stdin/stdout:
 * no port, therefore no port to secure, and no address for anything else on
 * the machine to reach.
 *
 * Images are passed as base64 in the message and never as a path. A payment
 * screenshot should not exist on disk even briefly — no temporary file to
 * clean up, no backup that quietly keeps a copy.
 *
 * The process is started on first use rather than at boot, so a deployment
 * that never uses recognition never pays the 260 MB of memory for it.
 */

/** Where the Python service lives, relative to the repository root. */
function serviceDirectory(): string {
  // The API runs from apps/api (dev) or from a built copy of it; either way the
  // OCR directory sits beside it inside the repository.
  const candidates = [
    path.resolve(process.cwd(), "apps/ocr"),
    path.resolve(process.cwd(), "../ocr"),
    path.resolve(process.cwd(), "../../apps/ocr"),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, "service.py"))) ?? candidates[0]!;
}

function interpreterPath(directory: string): string {
  const override = process.env["LIBELLUM_OCR_PYTHON"];
  if (override !== undefined && override !== "") return override;

  return process.platform === "win32"
    ? path.join(directory, ".venv", "Scripts", "python.exe")
    : path.join(directory, ".venv", "bin", "python");
}

/** Raw shape the Python side sends. Translated to the shared type below. */
interface RawResponse {
  readonly id?: string;
  readonly ready?: boolean;
  readonly ok?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly lineCount?: number;
  readonly averageConfidence?: number;
  readonly seconds?: number;
  readonly draft?: {
    readonly amount?: string | null;
    readonly currency?: string;
    readonly occurred_local_date?: string | null;
    readonly occurred_time?: string | null;
    readonly kind?: string;
    readonly channel?: string | null;
    readonly counterparty?: string | null;
    readonly note?: string | null;
    readonly serial?: string | null;
    readonly is_refund?: boolean;
    readonly warnings?: string[];
  };
}

interface Pending {
  readonly resolve: (value: RawResponse) => void;
  readonly reject: (error: Error) => void;
}

/** A failure of the OCR service itself, as opposed to a bad image. */
export class OcrServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrServiceError";
  }
}

/** Test/deployment seams; production uses the defaults. */
export interface OcrServiceOptions {
  readonly pythonPath?: string;
  readonly serviceDirectory?: string;
  readonly serviceFile?: string;
  readonly startupTimeoutMs?: number;
  readonly recognizeTimeoutMs?: number;
}

/** How long to wait for one screenshot before giving up on it. */
const RECOGNIZE_TIMEOUT_MS = 20_000;
/** How long to wait for the models to load on first use. */
const STARTUP_TIMEOUT_MS = 60_000;

export class OcrService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private onReady: (() => void) | null = null;

  constructor(private readonly options: OcrServiceOptions = {}) {}

  private serviceDirectory(): string {
    if (this.options.serviceDirectory !== undefined) return this.options.serviceDirectory;

    const file = this.options.serviceFile ?? "service.py";
    const candidates = [
      path.resolve(process.cwd(), "apps/ocr"),
      path.resolve(process.cwd(), "../ocr"),
      path.resolve(process.cwd(), "../../apps/ocr"),
    ];
    return candidates.find((candidate) => existsSync(path.join(candidate, file))) ?? candidates[0]!;
  }

  private interpreterPath(directory: string): string {
    if (this.options.pythonPath !== undefined && this.options.pythonPath !== "") {
      return this.options.pythonPath;
    }

    const override = process.env["LIBELLUM_OCR_PYTHON"];
    if (override !== undefined && override !== "") return override;

    return process.platform === "win32"
      ? path.join(directory, ".venv", "Scripts", "python.exe")
      : path.join(directory, ".venv", "bin", "python");
  }

  /** Start the recogniser if it is not already running. */
  private async ensureStarted(): Promise<void> {
    if (this.child !== null) return;
    if (this.readyPromise !== null) return this.readyPromise;

    const directory = this.serviceDirectory();
    const python = this.interpreterPath(directory);
    const serviceFile = this.options.serviceFile ?? "service.py";

    if (!existsSync(python)) {
      throw new OcrServiceError(
        `找不到 OCR 的 Python 环境（${python}）。请先运行 apps/ocr 里的安装步骤。`,
      );
    }

    let child: ChildProcessWithoutNullStreams | null = null;
    const readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (error: OcrServiceError): void => {
        if (settled) return;
        settled = true;
        if (this.startupTimer !== null) {
          clearTimeout(this.startupTimer);
          this.startupTimer = null;
        }
        if (this.readyPromise === readyPromise) this.readyPromise = null;
        if (this.onReady === ready) this.onReady = null;
        if (this.child === child) this.child = null;
        reject(error);
      };

      const ready = (): void => {
        if (settled) return;
        settled = true;
        if (this.startupTimer !== null) {
          clearTimeout(this.startupTimer);
          this.startupTimer = null;
        }
        resolve();
      };

      this.onReady = ready;

      try {
        child = spawn(python, [serviceFile], {
          cwd: directory,
          stdio: ["pipe", "pipe", "pipe"],
          // Keep the output as text: the protocol is JSON lines, and decoding
          // buffers by hand would only add a way to get it wrong.
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
      } catch (error) {
        reject(new OcrServiceError(`OCR 服务无法启动：${error instanceof Error ? error.message : String(error)}`));
        return;
      }

      this.child = child;
      this.startupTimer = setTimeout(() => {
        fail(new OcrServiceError("OCR 服务启动超时。"));
        try {
          child?.kill();
        } catch {
          // The child may already be gone; there is nothing else to clean up.
        }
      }, this.options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.consume(chunk);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // Technical detail belongs in the server log, never in a user response.
        console.warn("[ocr]", chunk.trim());
      });

      child.on("exit", (code) => {
        if (this.child === child) this.child = null;
        if (this.readyPromise === readyPromise) this.readyPromise = null;
        fail(new OcrServiceError(`OCR 服务在就绪前退出（code ${String(code)}）。`));

        for (const [, pending] of this.pending) {
          pending.reject(new OcrServiceError(`OCR 服务已退出（code ${String(code)}）。`));
        }
        this.pending.clear();
      });

      child.on("error", (error) => {
        if (this.child === child) this.child = null;
        if (this.readyPromise === readyPromise) this.readyPromise = null;
        fail(new OcrServiceError(`OCR 服务启动失败：${error.message}`));
      });
    });

    this.readyPromise = readyPromise;
    // A failed startup must not poison every later request: the next call gets
    // a fresh child. The catch is attached here so no rejected promise is left
    // unhandled when the caller is already gone.
    readyPromise.catch(() => {
      if (this.readyPromise === readyPromise) this.readyPromise = null;
    });
    return readyPromise;
  }

  /** Split incoming text into lines; each complete line is one response. */
  private consume(chunk: string): void {
    this.buffer += chunk;

    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);

      if (line !== "") this.handleLine(line);

      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let parsed: RawResponse;

    try {
      parsed = JSON.parse(line) as RawResponse;
    } catch {
      console.warn("[ocr] 无法解析的一行输出:", line.slice(0, 200));
      return;
    }

    if (parsed.ready === true) {
      this.onReady?.();
      return;
    }

    const id = parsed.id;
    if (id === undefined) return;

    const pending = this.pending.get(id);
    if (pending === undefined) return;

    this.pending.delete(id);
    pending.resolve(parsed);
  }

  /**
   * Recognise one image.
   *
   * Never throws for a bad image: an unreadable screenshot comes back as a
   * failed item so a batch can carry on with the rest. It throws only when the
   * service itself cannot run.
   */
  async recognize(image: Buffer, index: number): Promise<OcrItemResult> {
    await this.ensureStarted();

    const id = String(this.nextId++);
    const child = this.child;
    if (child === null) throw new Error("OCR 服务未运行。");

    const response = await new Promise<RawResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OcrServiceError("OCR 识别超时。"));
      }, this.options.recognizeTimeoutMs ?? RECOGNIZE_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      child.stdin.write(`${JSON.stringify({ id, image: image.toString("base64") })}\n`);
    });

    return toItemResult(response, index);
  }

  /** Stop the recogniser. Used on shutdown so the process does not linger. */
  stop(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    this.onReady = null;
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    child?.kill();
  }
}

/** The Python side uses snake_case; the rest of the codebase does not. */
function toItemResult(response: RawResponse, index: number): OcrItemResult {
  const base = {
    index,
    lineCount: response.lineCount ?? 0,
    averageConfidence: response.averageConfidence ?? 0,
    seconds: response.seconds ?? 0,
  };

  if (response.ok !== true || response.draft === undefined) {
    return {
      ...base,
      ok: false,
      draft: null,
      error: response.error ?? "recognition_failed",
      message: response.message ?? "识别失败。",
    };
  }

  const raw = response.draft;
  const channel = raw.channel;

  const draft: OcrDraft = {
    amount: raw.amount ?? null,
    currency: raw.currency ?? "CNY",
    occurredLocalDate: raw.occurred_local_date ?? null,
    occurredTime: raw.occurred_time ?? null,
    kind: raw.kind === "income" ? "income" : "expense",
    channel: channel === "WECHAT" || channel === "ALIPAY" || channel === "BANK" ? (channel as OcrChannel) : null,
    counterparty: raw.counterparty ?? null,
    note: raw.note ?? null,
    serial: raw.serial ?? null,
    isRefund: raw.is_refund ?? false,
    warnings: raw.warnings ?? [],
  };

  return { ...base, ok: true, draft, error: null, message: null };
}
