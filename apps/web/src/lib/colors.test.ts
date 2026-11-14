import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The colour rule, enforced rather than described.
 *
 * `docs/specs/design/颜色主题系统实现规范.md` and the colour checklist say components may not contain colour literals: adding a
 * colour means deciding which block it belongs to, and a block is a token. That
 * is easy to agree with and easy to break — one `#ffffff` in a hurry, and the
 * next person copies it. So it is checked here.
 *
 * index.css 与 S19 令牌表定义主题值。标签预设、历史头像插画与黑白二维码各自使用固定色。
 *
 * The chart palette and ocean fills used to be exemptions; S16-B0 moved both to
 * CSS variables, so they are checked like every other component now.
 *
 * Comments are stripped before checking, so the document and the code may talk
 * about a colour without tripping the rule.
 */

/**
 * Where to look.
 *
 * `import.meta.dirname` is the directory of this file (`src/lib`), so the
 * source root is its parent. Written this way because the first version used
 * `new URL("../", import.meta.url)` — a real URL object, where `fileURLToPath`
 * and `resolve` both expect a string, which failed at load time rather than at
 * an assertion.
 */
const SRC = resolve(import.meta.dirname, "..");

const TOKEN_FILES = new Set(["index.css", "s19/s19-lab-tokens.css", "s19/component-gallery/dark-study-tokens.css"]);

/** 只在已有用途内豁免固定色，同名文件或组件里新增的界面颜色仍然检查。 */
function scanSource(path: string): string {
  const name = relative(SRC, path).replace(/\\/g, "/");
  const source = stripComments(readFileSync(path, "utf8"));
  if (TOKEN_FILES.has(name)) return source.replace(/--[\w-]+\s*:[^;{}]+(?=;|})/g, "");
  if (name === "components/QrCodeView.tsx") return source.replace(/fill="#(?:ffffff|000000)"/g, "");
  if (name === "components/LegacyUserAvatar.tsx") return source.replace(/(?:fill|stroke)="#[\da-f]{6}"/gi, "");
  if (name === "lib/tagColors.ts") return source.replace(/"#[\da-f]{6}"/gi, '""');
  return source;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // A line comment, but not the `//` inside a URL like `https://`.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    found.push(path);
  }

  return found;
}

describe("colour literals", () => {
  const offenders: string[] = [];

  for (const path of sourceFiles(SRC)) {
    const source = scanSource(path);
    for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${relative(SRC, path).replace(/\\/g, "/")}:${String(line)} ${match[0]}`);
    }
  }

  it("appear only in token declarations, tag colours, QR ink or legacy avatar artwork", () => {
    expect(
      offenders,
      `组件里出现了硬编码颜色。请按 docs/specs/design/颜色主题系统实现规范.md 处理：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * ⚠️ **The hex rule had a hole: it only looked for hex.**
   *
   * `rgb()` and `rgba()` are the same mistake wearing a different hat — and the audit found the two
   * shadows in this project were written that way (`rgba(36,49,43,0.04)`), precisely because
   * **nothing was checking for them.** A guard that names one spelling of a colour teaches people the
   * other spelling is fine.
   *
   * ⚠️ **The `rgba(…, 0)` exemption is not a loophole, it is the point.** Tailwind's `box-shadow` and
   * `ring` utilities compose their value from transparent placeholders:
   * `rgba(0, 0, 0, 0) 0px 0px 0px 0px`. **That is not a colour, it is an empty slot** — and flagging it
   * would make the rule unpassable for any component using `shadow-*` or `ring-*`.
   */
  it("do not slip through as rgb() or rgba() either", () => {
    const rgbaOffenders: string[] = [];

    for (const path of sourceFiles(SRC)) {
      const source = scanSource(path);
      for (const match of source.matchAll(/rgba?\(\s*[\d.]+\s*[\s,/]+[^)]*\)/g)) {
        const value = match[0].replace(/\s+/g, " ");
        // ⚠️ `rgba(0, 0, 0, 0)` and `transparent` placeholders are structure, not colour.
        if (/rgba?\(\s*0[\s,]+0[\s,]+0\s*[\s,/]+0\s*\)/.test(value)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        rgbaOffenders.push(`${relative(SRC, path).replace(/\\/g, "/")}:${String(line)} ${value}`);
      }
    }

    expect(
      rgbaOffenders,
      `组件里出现了 rgb()/rgba() 硬编码颜色。颜色应来自 @theme token：\n  ${rgbaOffenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * S16-B0: the built-in palette is now checked by name.
   *
   * The earlier guard deliberately did not try this, because `text-white` was
   * correct on the green header and a name-based rule needed an allowlist. The
   * theme refactor replaced those uses with `on-*` roles, so the one remaining
   * legitimate fixed white is the QR plate — an optical requirement, not a
   * colour choice. Anything else here is a colour that would not follow a theme.
   */
  it("do not use Tailwind's built-in palette instead of a semantic token", () => {
    const builtIn =
      /\b(?:text|bg|border|ring|divide|placeholder|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?\b/g;
    const offenders: string[] = [];

    for (const path of sourceFiles(SRC)) {
      if (!/\.(ts|tsx)$/.test(path)) continue;
      const file = relative(SRC, path).replace(/\\/g, "/");
      const source = stripComments(readFileSync(path, "utf8"));
      for (const match of source.matchAll(builtIn)) {
        if (file === "components/QrCodeView.tsx" && match[0] === "bg-white") continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(SRC, path).replace(/\\/g, "/")}:${String(line)} ${match[0]}`);
      }
    }

    expect(
      offenders,
      `组件用了 Tailwind 内置色，主题切换时不会跟随语义 token：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * ⚠️ **This test is deliberately narrow, and the limit is worth writing down** — the owner asked
   * whether the check could cover *inline styles*, *unexpected Tailwind built-ins* and *ad-hoc opacity
   * combinations*, and the honest answer is **mostly no, not cheaply**:
   *
   *  * **Inline styles are legitimate here.** `style={{ backgroundColor: tag.color }}` is *user data*
   *    read from the database; `backgroundColor: heatColor(level)` is a computed chart value. A rule
   *    against inline colour would flag the two cases the palette cannot own, and the honest repair
   *    would be suppression comments — which is how a rule becomes noise.
   *  * **Inline style colour cannot be separated from data.** `style={{ backgroundColor: tag.color }}`
   *    and `backgroundColor: heatColor(level)` are the two cases the palette cannot own; a rule would
   *    need suppressions, and suppressions are how a rule becomes noise. (Tailwind built-ins *are* checked
   *    by name now that the `on-*` roles exist; only the QR plate remains exempt.)
   *  * **Opacity combinations are not wrong in themselves.** `text-white/80` on the brand header is a
   *    deliberate, documented limitation; a rule banning `/NN` would force it to be written some other
   *    way without making it more readable.
   *
   * **So the constraint is recorded in the design document instead** (`颜色主题系统实现规范.md` §7 and the legacy `颜色语义与配色规范.md` §4.3 and
   * §9.3), where a reader gets the *reason*, rather than encoded as a rule that misfires. **This is the
   * choice the owner offered: low-cost and reliable, or documented — not a complicated rule that
   * generates false alarms.**
   */
  it("stops where a rule would start misfiring, and says so", () => {
    const qr = scanSource(join(SRC, "components/QrCodeView.tsx"));
    expect(qr).not.toContain('fill="#ffffff"');
    expect(qr).toContain("<rect");
  });

  it("keeps the check honest by finding the files it is meant to guard", () => {
    // A guard that silently checks nothing is worse than no guard. If the walk
    // ever stops finding files — a wrong root, a renamed directory — this fails.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((path) => path.endsWith("index.css"))).toBe(true);
  });
});
