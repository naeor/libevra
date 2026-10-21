import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_BILL_IMPORT_BYTES } from "@libellum/shared";

import type { ExtractedDocument, ExtractedLine, ExtractedRow, ExtractedSheet } from "./types.js";

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

export class DocumentExtractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentExtractError";
    this.code = code;
  }
}

export interface DocumentExtractor {
  extract(buffer: Buffer): Promise<ExtractedDocument>;
}

export interface ExtractorOptions {
  /** 显式指定解释器；测试可注入一个假的 Python 路径。 */
  readonly pythonPath?: string;
  readonly scriptPath?: string;
  readonly timeoutMs?: number;
}

function venvPython(): string {
  const candidates = [
    path.resolve(process.cwd(), "apps/ocr/.venv/Scripts/python.exe"),
    path.resolve(process.cwd(), "../ocr/.venv/Scripts/python.exe"),
    path.resolve(process.cwd(), "../../apps/ocr/.venv/Scripts/python.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function resolvePython(options: ExtractorOptions): string {
  if (options.pythonPath !== undefined) return options.pythonPath;
  return (
    process.env["LIBELLUM_IMPORT_PYTHON"] ??
    process.env["LIBELLUM_OCR_PYTHON"] ??
    venvPython()
  );
}

/**
 * 脚本位置按运行形态依次探测：
 * - 仓库根运行（测试/`pnpm dev`）：apps/api/src/import/...
 * - 在 apps/api 目录下运行：src/import/...
 * - 编译/镜像里模块旁边：import.meta.url
 */
function resolveScript(options: ExtractorOptions): string {
  if (options.scriptPath !== undefined) return options.scriptPath;
  const fromEnv = process.env["LIBELLUM_IMPORT_SCRIPT"];
  if (fromEnv) return fromEnv;

  const candidates = [
    path.resolve(process.cwd(), "apps/api/src/import/extract_document.py"),
    path.resolve(process.cwd(), "src/import/extract_document.py"),
    path.resolve(process.cwd(), "../api/src/import/extract_document.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return fileURLToPath(new URL("./extract_document.py", import.meta.url));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDocument(value: unknown): ExtractedDocument {
  if (!isRecord(value)) throw new DocumentExtractError("document_invalid", "解析结果格式不正确。");
  const format = value["format"];
  if (format !== "pdf" && format !== "xlsx") {
    throw new DocumentExtractError("unsupported_format", "不支持的文件格式。");
  }

  const sheets: ExtractedSheet[] = [];
  if (Array.isArray(value["sheets"])) {
    for (const rawSheet of value["sheets"]) {
      if (!isRecord(rawSheet)) continue;
      const rows: ExtractedRow[] = [];
      if (Array.isArray(rawSheet["rows"])) {
        for (const rawRow of rawSheet["rows"]) {
          if (!isRecord(rawRow)) continue;
          const line = rawRow["line"];
          const cells = rawRow["cells"];
          if (typeof line !== "number" || !Array.isArray(cells)) continue;
          rows.push({
            line,
            cells: cells.map((cell) => (typeof cell === "string" ? cell : String(cell ?? ""))),
          });
        }
      }
      sheets.push({
        name: typeof rawSheet["name"] === "string" ? rawSheet["name"] : "",
        rows,
      });
    }
  }

  const pages: ExtractedLine[][] = [];
  if (Array.isArray(value["pages"])) {
    for (const rawPage of value["pages"]) {
      if (!Array.isArray(rawPage)) continue;
      const lines: ExtractedLine[] = [];
      for (const rawLine of rawPage) {
        if (!isRecord(rawLine)) continue;
        const y = rawLine["y"];
        const rawSpans = rawLine["spans"];
        if (typeof y !== "number" || !Array.isArray(rawSpans)) continue;
        const spans = rawSpans.flatMap((rawSpan) => {
          if (!isRecord(rawSpan)) return [];
          const x = rawSpan["x"];
          const text = rawSpan["text"];
          if (typeof x !== "number" || typeof text !== "string") return [];
          return [{ x, text }];
        });
        lines.push({ y, spans });
      }
      pages.push(lines);
    }
  }

  return { format, sheets, pages };
}

function runExtractor(
  pythonPath: string,
  scriptPath: string,
  buffer: Buffer,
  timeoutMs: number,
): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    if (buffer.length > MAX_BILL_IMPORT_BYTES) {
      reject(new DocumentExtractError("document_limit", "文件超过 10MB 上限。"));
      return;
    }
    if (!existsSync(scriptPath)) {
      reject(
        new DocumentExtractError("parser_unavailable", "文档解析器文件缺失，请联系管理员。"),
      );
      return;
    }

    let settled = false;
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderr: Buffer[] = [];
    let stderrBytes = 0;

    const child = spawn(pythonPath, [scriptPath], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });

    const finish = (error: Error | null, document?: ExtractedDocument) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== null) reject(error);
      else if (document !== undefined) resolve(document);
      else reject(new DocumentExtractError("document_invalid", "解析结果为空。"));
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new DocumentExtractError("parse_timeout", "文档解析超时。"));
    }, timeoutMs);

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        new DocumentExtractError(
          error.code === "ENOENT" ? "python_unavailable" : "parser_unavailable",
          "无法启动文档解析器。",
        ),
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new DocumentExtractError("document_limit", "解析结果过大。"));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      stderrBytes += chunk.length;
      stderr.push(chunk);
    });

    child.stdin.on("error", () => {
      // 子进程提前退出时会 EPIPE；真正的错误由 close/error 事件报告。
    });
    child.stdin.end(buffer);

    child.on("close", (code) => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (!output) {
        // 只把 stderr 写进服务端日志（由调用方记录），不进入用户可见消息。
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        void detail;
        finish(new DocumentExtractError("document_invalid", "解析器没有返回结果。"));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch {
        finish(new DocumentExtractError("document_invalid", "解析结果不是有效 JSON。"));
        return;
      }

      if (isRecord(parsed) && typeof parsed["error"] === "string") {
        finish(new DocumentExtractError(parsed["error"], "解析失败。"));
        return;
      }
      if (code !== 0) {
        finish(new DocumentExtractError("document_invalid", "解析失败。"));
        return;
      }

      try {
        finish(null, normalizeDocument(parsed));
      } catch (error) {
        finish(error instanceof DocumentExtractError ? error : new DocumentExtractError("document_invalid", "解析结果无法使用。"));
      }
    });
  });
}

export function createDocumentExtractor(options: ExtractorOptions = {}): DocumentExtractor {
  const pythonPath = resolvePython(options);
  const scriptPath = resolveScript(options);
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    extract(buffer: Buffer): Promise<ExtractedDocument> {
      return runExtractor(pythonPath, scriptPath, buffer, timeoutMs);
    },
  };
}
