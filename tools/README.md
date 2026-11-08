# tools · 阅读入口

开发、文档、检查与本地辅助工具；执行前阅读工具参数及授权边界。

优先阅读[任务索引](../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [_color-audit.mjs](_color-audit.mjs) | 实现模块；按文件名定位 _color-audit.mjs |
| [_contrast-audit.mjs](_contrast-audit.mjs) | 实现模块；按文件名定位 _contrast-audit.mjs |
| [_layout-audit.mjs](_layout-audit.mjs) | 实现模块；按文件名定位 _layout-audit.mjs |
| [_verify-layout.mjs](_verify-layout.mjs) | 实现模块；按文件名定位 _verify-layout.mjs |
| [add_currency_clocks.py](add_currency_clocks.py) | 实现模块；入口/导出：main |
| [add_sticky_toggle.py](add_sticky_toggle.py) | 实现模块；入口/导出：main |
| [agent-brief.mjs](agent-brief.mjs) | 实现模块；按文件名定位 agent-brief.mjs |
| [backup-verify.mjs](backup-verify.mjs) | 实现模块；按文件名定位 backup-verify.mjs |
| [build-docs.mjs](build-docs.mjs) | 实现模块；按文件名定位 build-docs.mjs |
| [check-build.mjs](check-build.mjs) | 实现模块；按文件名定位 check-build.mjs |
| [check-doc-anchors.mjs](check-doc-anchors.mjs) | 实现模块；按文件名定位 check-doc-anchors.mjs |
| [check-export-live.mjs](check-export-live.mjs) | 实现模块；按文件名定位 check-export-live.mjs |
| [check-links.mjs](check-links.mjs) | 实现模块；按文件名定位 check-links.mjs |
| [check-modules.mjs](check-modules.mjs) | 实现模块；按文件名定位 check-modules.mjs |
| [check-status.mjs](check-status.mjs) | 实现模块；按文件名定位 check-status.mjs |
| [check_names.py](check_names.py) | 实现模块；入口/导出：probe、main |
| [check_names2.py](check_names2.py) | 实现模块；入口/导出：probe、main |
| [check_usernames.py](check_usernames.py) | 实现模块；入口/导出：probe、main |
| [close_month_gap.py](close_month_gap.py) | 实现模块；入口/导出：main |
| [close_the_gap.py](close_the_gap.py) | 实现模块；入口/导出：main |
| [define_currency_clocks.py](define_currency_clocks.py) | 实现模块；入口/导出：main |
| [devlog_1031.py](devlog_1031.py) | 实现模块；入口/导出：main |
| [directory-index.mjs](directory-index.mjs) | 实现模块；按文件名定位 directory-index.mjs |
| [doc-audit.mjs](doc-audit.mjs) | 实现模块；按文件名定位 doc-audit.mjs |
| [drop_recent_row.py](drop_recent_row.py) | 实现模块；入口/导出：main |
| [find-intact-blob.mjs](find-intact-blob.mjs) | 实现模块；按文件名定位 find-intact-blob.mjs |
| [fix_currency_details.py](fix_currency_details.py) | 实现模块；入口/导出：css、page |
| [fx-integration-audit.mjs](fx-integration-audit.mjs) | 实现模块；按文件名定位 fx-integration-audit.mjs |
| [fx-migrate-test.mjs](fx-migrate-test.mjs) | 实现模块；按文件名定位 fx-migrate-test.mjs |
| [i18n-scan.mjs](i18n-scan.mjs) | 实现模块；入口/导出：scanSource、scanFile |
| [integration-baseline.config.ts](integration-baseline.config.ts) | 实现模块；按文件名定位 integration-baseline.config.ts |
| [integration-database.mjs](integration-database.mjs) | 实现模块；按文件名定位 integration-database.mjs |
| [layout-audit-2026-10-14.json](layout-audit-2026-10-14.json) | 结构化配置、资源或夹具 |
| [lift_cards_clear.py](lift_cards_clear.py) | 实现模块；入口/导出：css、page |
| [make-dev-cert.mjs](make-dev-cert.mjs) | 实现模块；按文件名定位 make-dev-cert.mjs |
| [md2docx.py](md2docx.py) | 实现模块；入口/导出：set_run_fonts、inline_runs、add_inline、style_heading、setup |
| [md2pdf.py](md2pdf.py) | 实现模块；入口/导出：sanitize、pick、Doc、register、_cmap |
| [move_devlog_section.py](move_devlog_section.py) | 实现模块；入口/导出：main |
| [point_docs_at_v1.py](point_docs_at_v1.py) | 实现模块；入口/导出：main |
| [record_s6_step1_state.py](record_s6_step1_state.py) | 实现模块；入口/导出：main |
| [redact-in-docs.mjs](redact-in-docs.mjs) | 实现模块；按文件名定位 redact-in-docs.mjs |
| [reset-recovery-code.mjs](reset-recovery-code.mjs) | 实现模块；按文件名定位 reset-recovery-code.mjs |
| [rework_currency_block.py](rework_currency_block.py) | 实现模块；入口/导出：main |
| [rework_currency_css.py](rework_currency_css.py) | 实现模块；入口/导出：main |
| [rework_currency_markup.py](rework_currency_markup.py) | 实现模块；入口/导出：main |
| [s6_step1_schema.py](s6_step1_schema.py) | 实现模块；入口/导出：add_relation、main |
| [s6_step1_schema_b.py](s6_step1_schema_b.py) | 实现模块；入口/导出：main |
| [seed-test-account.mjs](seed-test-account.mjs) | 实现模块；按文件名定位 seed-test-account.mjs |
| [sync_docs.py](sync_docs.py) | 实现模块；入口/导出：main |
| [verify-reading-pdf.py](verify-reading-pdf.py) | 实现模块；入口/导出：verify |
| [verify-typography.mjs](verify-typography.mjs) | 实现模块；按文件名定位 verify-typography.mjs |
| [write_migration_sql.py](write_migration_sql.py) | 实现模块；入口/导出：main |

| 子目录 | 职责 |
|---|---|
| [e2e/](e2e/README.md) | 浏览器验证工具。 |
<!-- directory-index:end -->
