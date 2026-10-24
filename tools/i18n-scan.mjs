#!/usr/bin/env node
/**
 * S16 国际化：扫描 Web 源码里**还没有走翻译的中文**。
 *
 * 用法：
 *   node tools/i18n-scan.mjs                      # 扫描 apps/web/src 全部（不含测试与文案资源）
 *   node tools/i18n-scan.mjs apps/web/src/pages/LoginPage.tsx …   # 只扫描指定文件
 *   node tools/i18n-scan.mjs --json               # 机器可读输出
 *   node tools/i18n-scan.mjs --summary            # 按文件计数
 *
 * 规则：注释里的中文不算；字符串、模板字符串、JSX 文本、正则里的中文都算。
 * 确实需要保留中文的地方（识别关键词、与服务器约定的原文、数据而非界面文字），在**同一行**写
 * `i18n-ignore` 注释并说明原因；整份文件都是数据时，在文件里写 `i18n-ignore-file`。
 *
 * 只读，不改任何文件。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WEB_SRC = join(ROOT, "apps", "web", "src");
const CJK = /[㐀-鿿豈-﫿]/u;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const summary = args.includes("--summary");
const files = args.filter((arg) => !arg.startsWith("--"));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (name === "node_modules" || name === "generated") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function isExcluded(file) {
  const rel = relative(WEB_SRC, file).replaceAll("\\", "/");
  return rel.startsWith("i18n/resources/") || rel === "i18n/sharedMessages.ts" || rel === "i18n/locales.ts";
}

/**
 * 极简词法：区分代码 / 行注释 / 块注释 / 字符串 / 模板字符串，返回非注释区域里含中文的行。
 * 正则字面量按代码处理（里面的中文同样会被报告，需要的话用 i18n-ignore 标注）。
 */
export function scanSource(text) {
  const hits = new Map(); // line -> true
  let state = "code";
  let quote = "";
  const templateDepth = [];
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\n") {
      line += 1;
      if (state === "line") state = "code";
      continue;
    }
    switch (state) {
      case "code":
        if (ch === "/" && next === "/") {
          state = "line";
          i += 1;
        } else if (ch === "/" && next === "*") {
          state = "block";
          i += 1;
        } else if (ch === '"' || ch === "'") {
          state = "string";
          quote = ch;
        } else if (ch === "`") {
          state = "template";
        } else if (ch === "}" && templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          state = "template";
        } else {
          if (ch === "{" && templateDepth.length > 0) templateDepth[templateDepth.length - 1] += 1;
          if (ch === "}" && templateDepth.length > 0) templateDepth[templateDepth.length - 1] -= 1;
          if (CJK.test(ch)) hits.set(line, true);
        }
        break;
      case "line":
        break;
      case "block":
        if (ch === "*" && next === "/") {
          state = "code";
          i += 1;
        }
        break;
      case "string":
        if (ch === "\\") {
          i += 1;
        } else if (ch === quote) {
          state = "code";
        } else if (CJK.test(ch)) {
          hits.set(line, true);
        }
        break;
      case "template":
        if (ch === "\\") {
          i += 1;
        } else if (ch === "`") {
          state = "code";
        } else if (ch === "$" && next === "{") {
          templateDepth.push(0);
          state = "code";
          i += 1;
        } else if (CJK.test(ch)) {
          hits.set(line, true);
        }
        break;
      default:
        break;
    }
  }
  return [...hits.keys()].sort((a, b) => a - b);
}

export function scanFile(file) {
  const text = readFileSync(file, "utf8");
  if (text.includes("i18n-ignore-file")) return [];
  const lines = text.split("\n");
  return scanSource(text)
    .filter((lineNo) => !lines[lineNo - 1].includes("i18n-ignore"))
    .map((lineNo) => ({ line: lineNo, text: lines[lineNo - 1].trim().slice(0, 140) }));
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);

if (isMain) {
  const targets = (files.length > 0 ? files.map((file) => resolve(file)) : walk(WEB_SRC)).filter((file) => !isExcluded(file));
  const report = [];
  for (const file of targets) {
    const found = scanFile(file);
    if (found.length > 0) report.push({ file: relative(ROOT, file).replaceAll("\\", "/"), hits: found });
  }
  const total = report.reduce((sum, item) => sum + item.hits.length, 0);
  if (asJson) {
    console.log(JSON.stringify({ total, files: report }, null, 2));
  } else if (summary) {
    for (const item of report.sort((a, b) => b.hits.length - a.hits.length)) console.log(`${String(item.hits.length).padStart(5)}  ${item.file}`);
    console.log(`TOTAL ${total} lines in ${report.length} files`);
  } else {
    for (const item of report) {
      for (const hit of item.hits) console.log(`${item.file}:${hit.line}: ${hit.text}`);
    }
    console.log(`TOTAL ${total} lines in ${report.length} files`);
  }
}
