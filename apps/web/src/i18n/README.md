# apps/web/src/i18n · 阅读入口

语言控制器、资源和本地化内容。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [apiErrors.test.ts](apiErrors.test.ts) | 测试：apiErrors |
| [historyServerValues.test.ts](historyServerValues.test.ts) | 测试：historyServerValues |
| [i18n.test.ts](i18n.test.ts) | 测试：i18n |
| [i18next.d.ts](i18next.d.ts) | 实现模块；按文件名定位 i18next.d.ts |
| [index.ts](index.ts) | 实现模块；入口/导出：missingTranslationKeys、clearMissingTranslationKeys、i18n、currentLocale、isChineseLocale |
| [locales.ts](locales.ts) | 实现模块；入口/导出：SUPPORTED_LOCALES、Locale、SOURCE_LOCALE、UNMATCHED_BROWSER_LOCALE、LOCALE_NATIVE_NAMES |
| [pseudo.ts](pseudo.ts) | 实现模块；入口/导出：pseudoLocalizeText、pseudoLocalizeTree、PSEUDO_LOCALE、PSEUDO_STORAGE_KEY、pseudoEnabled |
| [sharedMessages.test.ts](sharedMessages.test.ts) | 测试：sharedMessages |
| [sharedMessages.ts](sharedMessages.ts) | 实现模块；按文件名定位 sharedMessages.ts |
| [types.ts](types.ts) | 实现模块；入口/导出：Messages、MessageTree |

| 子目录 | 职责 |
|---|---|
| [content/](content/README.md) | 本层组织 content 模块的直属文件；具体契约由任务索引定位。 |
| [resources/](resources/README.md) | 本地化资源。 |
<!-- directory-index:end -->
