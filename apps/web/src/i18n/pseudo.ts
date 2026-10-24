/**
 * **伪语言（仅开发环境）：提前发现“换一种更长的语言就会破版”的地方。**
 *
 * 由英文文案生成：字母换成带重音的同形字母、每条加长约 40%、两端加 `⟦ ⟧`。这样在页面上一眼就能看出
 * 三件事：哪些文字**没有走翻译**（没有括号）、哪里被**截断**（看不到右括号）、哪里被**撑坏**（加长后错位）。
 *
 * 启用：开发服务器下在浏览器控制台执行 `localStorage.setItem("libevra.pseudo", "1")` 后刷新，并把语言设为
 * English；关闭：删掉这个键。生产构建里 `import.meta.env.DEV` 为假，整段代码不会生效。
 *
 * ⚠️ `{{占位符}}` 与 `<b>` / `<1>` 之类的标签原样保留，否则插值与 `<Trans>` 会失效。
 */
const ACCENTS: Readonly<Record<string, string>> = {
  a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í", j: "ĵ", k: "ķ", l: "ľ", m: "ɱ",
  n: "ñ", o: "ó", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "ú", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í", J: "Ĵ", K: "Ķ", L: "Ľ", M: "Ṁ",
  N: "Ñ", O: "Ó", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Ú", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

/** 把一条文案变成伪语言；占位符与标签不动。 */
export function pseudoLocalizeText(text: string): string {
  const parts = text.split(/(\{\{[^}]*\}\}|<[^>]+>)/g);
  let letters = 0;
  const body = parts
    .map((part) => {
      if (part.startsWith("{{") || part.startsWith("<")) return part;
      return part.replace(/[A-Za-z]/g, (ch) => {
        letters += 1;
        return ACCENTS[ch] ?? ch;
      });
    })
    .join("");
  const padding = "·".repeat(Math.max(1, Math.round(letters * 0.4)));
  return `⟦${body}${padding}⟧`;
}

type Tree = { readonly [key: string]: string | Tree };

export function pseudoLocalizeTree<T>(tree: T): T {
  const walk = (node: Tree): Tree => {
    const out: Record<string, string | Tree> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = typeof value === "string" ? pseudoLocalizeText(value) : walk(value);
    }
    return out;
  };
  return walk(tree as unknown as Tree) as unknown as T;
}

export const PSEUDO_LOCALE = "en-XA";
export const PSEUDO_STORAGE_KEY = "libevra.pseudo";

/** 开发环境下本机是否打开了伪语言。 */
export function pseudoEnabled(): boolean {
  if (import.meta.env?.DEV !== true || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PSEUDO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
