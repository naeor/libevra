/**
 * 文案资源的类型约束。
 *
 * `zh-CN` 是源语言：它的对象结构就是全部键的定义。其他语言用 `Messages<typeof zh>` 声明，
 * **少一个键、多一个键、把字符串写成对象，都会在 `pnpm typecheck` 里直接报错**，不必等到页面上
 * 才发现英文漏翻。
 *
 * 复数：英文需要 `_one` / `_other` 两种形式（i18next 按 `Intl.PluralRules` 选择）。中文没有单复数，
 * 但为了让两种语言的键结构完全一致，中文也写 `_one` 与 `_other`，两条内容相同即可。
 */
export type Messages<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
};

/** 源语言模块的写法：只约束“字符串或嵌套对象”，键名由对象字面量自己决定。 */
export interface MessageTree {
  readonly [key: string]: string | MessageTree;
}
