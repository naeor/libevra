import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 1.19.82：除手动记账外的记账方式页（文本、语音、拍照、导入账单）与它们的核对页，离开前有改动就先问放弃
 * （所有者 2026-11-15：“所有的记账方式退出时都要问放弃；但如果记账页面没做任何改动的话，退出就不用问放弃”；
 * “尽可能让所有的东西都用我们自己风格的对话框”）。系统返回的保护记录需要浏览器，这里锁住接线。
 */
const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const pages = {
  "文本记账": "PastePage.tsx",
  "语音记账": "RecordPage.tsx",
  "拍照记账": "ScanPage.tsx",
  "导入账单": "ImportPage.tsx",
  "识别核对（文本/语音）": "VoiceReviewPage.tsx",
  "批量识别结果": "OcrOverviewPage.tsx",
  "批量里的单笔核对": "OcrReviewDetailPage.tsx",
} as const;

describe("记账方式页离开前询问：接线", () => {
  for (const [label, file] of Object.entries(pages)) {
    const source = read(file);
    it(`${label}：用 useLeaveConfirm、顶栏返回接 requestLeave、渲染 ConfirmDialog`, () => {
      expect(source).toContain("useLeaveConfirm(");
      expect(source).toContain("onBack={leave.requestLeave}");
      expect(source).toMatch(/<ConfirmDialog\s+\{\.\.\.leave\.dialog\}/);
    });
  }

  it("页内去别处的入口先问（askLeave），往前走的入口撤掉保护记录而不询问", () => {
    expect(read("PastePage.tsx")).toContain('leave.askLeave("/add")');
    for (const page of ["PastePage.tsx", "RecordPage.tsx", "ScanPage.tsx", "OcrOverviewPage.tsx"]) expect(read(page)).toContain("const goForward = leave.proceed;");
    expect(read("PastePage.tsx")).toContain('goForward("/paste/review")');
    expect(read("RecordPage.tsx")).toContain('goForward("/voice/review")');
    expect(read("ScanPage.tsx")).toContain('goForward("/ocr/overview")');
    expect(read("ScanPage.tsx")).toContain('leave.askLeave("/")');
    expect(read("OcrOverviewPage.tsx")).toContain("goForward(`/ocr/overview/${encodeURIComponent(candidateId)}`)");
    expect(read("OcrOverviewPage.tsx")).toContain('leave.askLeave("/scan")');
    expect(read("VoiceReviewPage.tsx")).toContain('leave.askLeave("/add")');
    expect(read("ImportPage.tsx")).toContain("leave.askLeave(exportTo)");
  });

  it("“有改动”的判断：原样没动、已保存或导入完成、保存进行中都不问", () => {
    const paste = read("PastePage.tsx");
    expect(paste).toContain('const dirty = text.trim() !== "" || candidates !== null || attachments.files.length > 0;');
    const record = read("RecordPage.tsx");
    expect(record).toContain('const dirty = recorder.state !== "idle" || transcribe.isPending || hasHeard || attachments.files.length > 0;');
    const scan = read("ScanPage.tsx");
    expect(scan).toContain('step.name === "working" ||');
    expect(scan).toContain('(step.name === "review" && !saving) ||');
    expect(scan).toContain('(step.name === "pick" && (files.length > 0 || attachments.files.length > 0)) ||');
    const imp = read("ImportPage.tsx");
    expect(imp).toContain('step.name !== "done" && busy !== "commit" && (file !== null || step.name !== "choose" || attachments.files.length > 0)');
    const voice = read("VoiceReviewPage.tsx");
    expect(voice).toContain('spoken !== null && saved === null && !saving && (spoken.source !== "paste" || touched)');
    const overview = read("OcrOverviewPage.tsx");
    expect(overview).toContain("batch !== null && items.length > 0 && done === null && !importing");
    const detail = read("OcrReviewDetailPage.tsx");
    expect(detail).toContain("JSON.stringify(form) !== JSON.stringify(initialForm(item))");
  });

  it("保存后、取消这批后的离开不再询问，且不被自己的保护记录拦住", () => {
    expect(read("OcrReviewDetailPage.tsx")).toContain("leave.confirmLeave();");
    expect(read("OcrOverviewPage.tsx")).toContain('goForward("/scan");');
  });

  it("文本记账确认放弃时连同本标签页草稿一起清空（对话框说“不会保留”就要真的不保留）", () => {
    const paste = read("PastePage.tsx");
    expect(paste).toMatch(/leave\.dialog\.onConfirm\(\);\s*setText\(""\);\s*setCandidates\(null\);/);
  });

  it("拍照记账：确认放弃离开后，晚到的识别结果不再把用户带去概览或核对", () => {
    const scan = read("ScanPage.tsx");
    expect(scan).toContain("if (!alive.current) return;");
  });
});

describe("离开前询问的文案", () => {
  it("中英文都有（capture.leave.*、ocr.detail.leave*、dataio.import.leave*）", () => {
    for (const locale of ["zh-CN", "en-US"]) {
      const capture = readFileSync(new URL(`../i18n/resources/${locale}/capture.ts`, import.meta.url), "utf8");
      expect(capture).toMatch(/leave: \{\s*title:[^\n]+\n\s*body:[^\n]+\n\s*confirm:[^\n]+\n\s*keep:/);
      for (const file of ["ocr", "dataio"] as const) {
        const text = readFileSync(new URL(`../i18n/resources/${locale}/${file}.ts`, import.meta.url), "utf8");
        for (const key of ["leaveTitle", "leaveBody", "leaveConfirm", "leaveKeep"]) expect(text).toContain(`${key}:`);
      }
    }
  });
});
