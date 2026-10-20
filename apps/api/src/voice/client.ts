import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Talks to the Python transcriber.
 *
 * The same shape as the OCR client beside it, and for the same reasons: one
 * long-lived process because loading the model costs six seconds, JSON lines over
 * a pipe rather than HTTP because a pipe has no address to secure.
 *
 * **The audio never touches the disk.** It arrives as a buffer from the request,
 * is base64-encoded into the message, and is decoded in the child's memory. This
 * matters more here than it does for a screenshot: a recording of somebody's
 * voice is the most sensitive thing this project handles, and a temporary file is
 * a thing that can be forgotten, backed up, or read by something else on the
 * machine.
 *
 * **`transcribe` is the entire interface.** The engine behind it — whisper.cpp
 * today, `faster-whisper` or a hosted API later, or the browser's own engine
 * instead of a server call at all — is this file's business and nobody else's.
 * The owner asked for that seam, because the hard part is the recognition and the
 * easy-to-get-wrong part is turning a sentence into fields.
 */

/** Where the Python service lives, relative to the repository root. */
function serviceDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), "apps/voice"),
    path.resolve(process.cwd(), "../voice"),
    path.resolve(process.cwd(), "../../apps/voice"),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, "service.py"))) ?? candidates[0]!;
}

/**
 * Which Python runs it.
 *
 * **The OCR virtualenv, reused.** Speech and OCR are two sidecars of one project,
 * and building a second environment would mean a second copy of numpy and a
 * second place to forget to install something. `LIBELLUM_VOICE_PYTHON` overrides
 * it, which is what a deployment with a separate environment would set.
 */
function interpreterPath(directory: string): string {
  const override = process.env["LIBELLUM_VOICE_PYTHON"];
  if (override !== undefined && override !== "") return override;

  const ocrDirectory = path.resolve(directory, "..", "ocr");
  const shared = process.platform === "win32"
    ? path.join(ocrDirectory, ".venv", "Scripts", "python.exe")
    : path.join(ocrDirectory, ".venv", "bin", "python");

  if (existsSync(shared)) return shared;

  return process.platform === "win32"
    ? path.join(directory, ".venv", "Scripts", "python.exe")
    : path.join(directory, ".venv", "bin", "python");
}

/** Raw shape the Python side sends. */
interface RawResponse {  readonly id?: string;
  readonly ready?: boolean;
  readonly loading?: boolean;
  readonly ok?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly text?: string;
  readonly seconds?: number;
  readonly audioSeconds?: number;
  readonly speechless?: boolean;
  readonly activeSeconds?: number | null;
  readonly timings?: VoiceTimings;
}

export interface VoiceTimings {
  readonly decodeMs: number;
  readonly vadMs: number;
  readonly inferMs: number;
  readonly totalMs: number;
}

export interface Transcription {
  readonly text: string;
  readonly audioSeconds: number;
  readonly seconds: number;
  readonly speechless?: boolean;
  readonly timings?: VoiceTimings;
}

/** Raised when the audio itself is the problem, with a message worth showing. */
export class TranscriptionRejected extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptionRejected";
  }
}

interface Pending {
  readonly resolve: (value: RawResponse) => void;
  readonly reject: (error: Error) => void;
}

/** A failure of the transcriber itself, as opposed to a bad recording. */
export class VoiceServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceServiceError";
  }
}

/**
 * Raised when the transcriber is **busy** rather than broken: the queue is full,
 * or a request waited too long for a slot.
 *
 * Separate from `VoiceServiceError` so the route can answer "try again shortly"
 * instead of "the service is down". Only one of those is true at a time, and the
 * two need different words — a user who retries a 503 may give up on a feature
 * that would have worked a second later.
 */
export class VoiceBusyError extends VoiceServiceError {
  constructor(message: string) {
    super(message);
    this.name = "VoiceBusyError";
  }
}

/**
 * How many transcriptions may run at once, how many may wait, and for how long.
 *
 * ⚠️ **These are a conservative starting point, not the owner's decision.** S15-A
 * says the concurrency limit and timeout are to be confirmed by him; the code
 * needs a sane bound today rather than an unbounded queue:
 *
 *  * **2 in flight** — one whisper decode already uses both vCPUs' threads, so
 *    this is an upper bound rather than a target; the queue absorbs a burst.
 *  * **4 queued** — past that somebody waits longer than they would care to, so
 *    a new request is refused fast instead of piling up behind the slow ones.
 *  * **15 s queued** — voice entry is a "say it and see it" interaction; a result
 *    two minutes later is worse than a clear "忙，稍后再试".
 *
 * Overridable per instance so a test — or a deployment that has measured its own
 * host — can change them without editing these lines.
 */
const MAX_CONCURRENT_TRANSCRIPTIONS = 2;
const MAX_QUEUED_TRANSCRIPTIONS = 4;
const QUEUE_TIMEOUT_MS = 15_000;

/** One request waiting for a transcription slot. */
interface QueuedTranscription {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Test/deployment seams; production uses the defaults. */
export interface VoiceServiceOptions {
  readonly pythonPath?: string;
  readonly serviceDirectory?: string;
  readonly serviceFile?: string;
  readonly startupTimeoutMs?: number;
  readonly transcribeTimeoutMs?: number;
  /** Transcriptions allowed in flight at once. Defaults to 2. */
  readonly maxConcurrent?: number;
  /** Requests allowed to wait for a slot before new ones are refused. Defaults to 4. */
  readonly maxQueue?: number;
  /** How long a queued request waits for a slot before it is refused. Defaults to 15 s. */
  readonly queueTimeoutMs?: number;
}

/**
 * How long to wait for one recording.
 *
 * The normal warm request is a few seconds of audio plus model inference; a
 * ceiling of two minutes still leaves room for a slow first model load but no
 * longer lets a dead sidecar hang a request for five minutes.
 */
const TRANSCRIBE_TIMEOUT_MS = 120_000;
/** How long to wait for the model to load, or to arrive, on first use. */
const STARTUP_TIMEOUT_MS = 120_000;

export class VoiceService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private onReady: (() => void) | null = null;

  /** Transcriptions currently running. Bounded by `maxConcurrent`. */
  private active = 0;
  /** Transcriptions waiting for a slot, oldest first. */
  private readonly waiting: QueuedTranscription[] = [];

  constructor(private readonly options: VoiceServiceOptions = {}) {}

  private get concurrencyLimit(): number {
    return Math.max(1, this.options.maxConcurrent ?? MAX_CONCURRENT_TRANSCRIPTIONS);
  }

  /**
   * Take a slot, or wait for one, or fail fast.
   *
   * ⚠️ **The bound is the point, not the queue.** Whisper runs on the CPU, and a
   * burst of recordings does not get faster by being handed to the same two
   * cores: it gets slower for everyone and the normal bookkeeping API competes
   * with it. Admitting a bounded number and refusing past a bounded queue keeps
   * the failure small and immediate instead of a slow-motion outage.
   */
  private acquire(): Promise<void> {
    if (this.active < this.concurrencyLimit) {
      this.active += 1;
      return Promise.resolve();
    }

    const maxQueue = Math.max(0, this.options.maxQueue ?? MAX_QUEUED_TRANSCRIPTIONS);

    if (this.waiting.length >= maxQueue) {
      return Promise.reject(new VoiceBusyError("语音识别同时请求过多，请稍后再试。"));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: QueuedTranscription = {
        resolve: () => {
          if (waiter.timer !== null) clearTimeout(waiter.timer);
          resolve();
        },
        reject: (error) => {
          if (waiter.timer !== null) clearTimeout(waiter.timer);
          reject(error);
        },
        timer: null,
      };

      waiter.timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new VoiceBusyError("语音识别排队超时，请稍后再试。"));
      }, Math.max(1, this.options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS));

      this.waiting.push(waiter);
    });
  }

  /** Give the slot back and hand it to the oldest waiter, if there is one. */
  private release(): void {
    this.active = Math.max(0, this.active - 1);

    while (this.active < this.concurrencyLimit) {
      const next = this.waiting.shift();
      if (next === undefined) return;

      this.active += 1;
      next.resolve();
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child !== null) return;
    if (this.readyPromise !== null) return this.readyPromise;

    const directory = this.options.serviceDirectory ?? serviceDirectory();
    const python = this.options.pythonPath ?? interpreterPath(directory);
    const serviceFile = this.options.serviceFile ?? "service.py";

    if (!existsSync(python)) {
      throw new VoiceServiceError(
        `找不到语音识别的 Python 环境（${python}）。请先运行 apps/ocr 里的安装步骤，并安装 pywhispercpp 与 av。`,
      );
    }

    let child: ChildProcessWithoutNullStreams | null = null;
    const readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (error: VoiceServiceError): void => {
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
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
      } catch (error) {
        reject(
          new VoiceServiceError(
            `语音识别服务无法启动：${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }

      this.child = child;
      this.startupTimer = setTimeout(() => {
        fail(new VoiceServiceError("语音识别服务启动超时。"));
        try {
          child?.kill();
        } catch {
          // Already gone; nothing else to clean up.
        }
      }, this.options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.consume(chunk);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        // Not fatal. Model loading writes its progress here, which is worth
        // seeing the first time and noise afterwards.
        const line = chunk.trim();
        if (line !== "") console.warn("[voice]", line);
      });

      /**
       * A write to a child that has just died emits `EPIPE` on stdin. Without a
       * listener that is an unhandled 'error' event, which crashes the API
       * process — one dead transcriber would take the whole server with it.
       * The `exit` handler below is what rejects the pending requests.
       */
      child.stdin.on("error", (error: Error) => {
        console.warn("[voice] stdin:", error.message);
      });

      child.on("exit", (code) => {
        if (this.child === child) this.child = null;
        if (this.readyPromise === readyPromise) this.readyPromise = null;
        fail(new VoiceServiceError(`语音识别服务在就绪前退出（code ${String(code)}）。`));

        for (const [, pending] of this.pending) {
          pending.reject(new VoiceServiceError(`语音识别服务已退出（code ${String(code)}）。`));
        }
        this.pending.clear();
      });

      child.on("error", (error) => {
        if (this.child === child) this.child = null;
        if (this.readyPromise === readyPromise) this.readyPromise = null;
        fail(new VoiceServiceError(`语音识别服务启动失败：${error.message}`));
      });
    });

    this.readyPromise = readyPromise;
    // A failed startup must not poison every later request: the next call gets
    // a fresh child. The catch is attached so no rejected promise is unhandled.
    readyPromise.catch(() => {
      if (this.readyPromise === readyPromise) this.readyPromise = null;
    });
    return readyPromise;
  }

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
      console.warn("[voice] 无法解析的一行输出:", line.slice(0, 200));
      return;
    }

    // `{"ready": false, "loading": true}` is the service saying it has started.
    // Treated as ready so the caller stops waiting: the *first transcription*
    // carries its own, longer timeout, and blocking the request here for six
    // seconds of model loading would hide the progress from the user.
    if (parsed.ready !== undefined || parsed.loading === true) {
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
   * Transcribe one recording.
   *
   * Throws `TranscriptionRejected` when the audio is unusable — too long, the
   * wrong format, silent — because that is something the user can act on. Throws
   * a plain `Error` only when the service itself cannot run, which is not. Throws
   * `VoiceBusyError` when the request could not even be admitted.
   */
  async transcribe(audio: Buffer, language = "zh"): Promise<Transcription> {
    /**
     * The slot is taken **before** the child is started.
     *
     * A burst that arrives while the first request is loading the model should
     * wait in the queue, not all reach the pipe: writing five recordings into a
     * child that decodes one at a time only turns five slow requests into five
     * slower ones, and the timeouts start counting from the wrong moment.
     */
    await this.acquire();

    try {
      return await this.transcribeInSlot(audio, language);
    } finally {
      this.release();
    }
  }

  private async transcribeInSlot(audio: Buffer, language: string): Promise<Transcription> {
    await this.ensureStarted();

    const id = String(this.nextId++);
    const child = this.child;
    if (child === null) throw new VoiceServiceError("语音识别服务未运行。");

    const response = await new Promise<RawResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new VoiceServiceError("语音识别超时。"));
      }, this.options.transcribeTimeoutMs ?? TRANSCRIBE_TIMEOUT_MS);

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

      child.stdin.write(`${JSON.stringify({ id, audio: audio.toString("base64"), language })}\n`);
    });

    if (response.ok !== true) {
      throw new TranscriptionRejected(
        response.error ?? "transcribe_failed",
        response.message ?? "识别失败，请再试一次。",
      );
    }

    return {
      text: response.text ?? "",
      audioSeconds: response.audioSeconds ?? 0,
      seconds: response.seconds ?? 0,
      ...(response.speechless === undefined ? {} : { speechless: response.speechless }),
      ...(response.timings === undefined ? {} : { timings: response.timings }),
    };
  }

  /** Stop the transcriber so the process does not outlive the server. */
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

    // A queued request must not wait for a child that is going away.
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new VoiceServiceError("语音识别服务已停止。"));
    }
  }
}
