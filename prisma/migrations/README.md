# prisma/migrations · 阅读入口

按目录时间排序的 SQL 迁移单元；不修改已应用迁移，不在每个迁移目录生成 README。

优先阅读[任务索引](../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [migration_lock.toml](migration_lock.toml) | 配置 |

| 子目录 | 职责 |
|---|---|
| [20261008072457_init/](20261008072457_init) | 本层组织 20261008072457_init 模块的直属文件；具体契约由任务索引定位。 |
| [20261009060353_auth/](20261009060353_auth) | 本层组织 20261009060353_auth 模块的直属文件；具体契约由任务索引定位。 |
| [20261009070950_account_number/](20261009070950_account_number) | 本层组织 20261009070950_account_number 模块的直属文件；具体契约由任务索引定位。 |
| [20261009074700_numeric_account_number/](20261009074700_numeric_account_number) | 本层组织 20261009074700_numeric_account_number 模块的直属文件；具体契约由任务索引定位。 |
| [20261009095000_ledger_core/](20261009095000_ledger_core) | 本层组织 20261009095000_ledger_core 模块的直属文件；具体契约由任务索引定位。 |
| [20261009100000_system_category/](20261009100000_system_category) | 本层组织 20261009100000_system_category 模块的直属文件；具体契约由任务索引定位。 |
| [20261009110000_backfill_ledger_for_existing_accounts/](20261009110000_backfill_ledger_for_existing_accounts) | 本层组织 20261009110000_backfill_ledger_for_existing_accounts 模块的直属文件；具体契约由任务索引定位。 |
| [20261009120000_category_descriptions/](20261009120000_category_descriptions) | 本层组织 20261009120000_category_descriptions 模块的直属文件；具体契约由任务索引定位。 |
| [20261009130000_default_currency/](20261009130000_default_currency) | 本层组织 20261009130000_default_currency 模块的直属文件；具体契约由任务索引定位。 |
| [20261010120500_s6_export_and_import/](20261010120500_s6_export_and_import) | 本层组织 20261010120500_s6_export_and_import 模块的直属文件；具体契约由任务索引定位。 |
| [20261010123000_s6_export_and_import/](20261010123000_s6_export_and_import) | 本层组织 20261010123000_s6_export_and_import 模块的直属文件；具体契约由任务索引定位。 |
| [20261010124000_tighten_reference_shape/](20261010124000_tighten_reference_shape) | 本层组织 20261010124000_tighten_reference_shape 模块的直属文件；具体契约由任务索引定位。 |
| [20261010163000_sequential_account_numbers/](20261010163000_sequential_account_numbers) | 本层组织 20261010163000_sequential_account_numbers 模块的直属文件；具体契约由任务索引定位。 |
| [20261010173000_book_numbers/](20261010173000_book_numbers) | 本层组织 20261010173000_book_numbers 模块的直属文件；具体契约由任务索引定位。 |
| [20261010190000_invite_expiry_and_revocation/](20261010190000_invite_expiry_and_revocation) | 本层组织 20261010190000_invite_expiry_and_revocation 模块的直属文件；具体契约由任务索引定位。 |
| [20261010200000_invite_grants_admin/](20261010200000_invite_grants_admin) | 本层组织 20261010200000_invite_grants_admin 模块的直属文件；具体契约由任务索引定位。 |
| [20261011133000_multi_device_sessions/](20261011133000_multi_device_sessions) | 本层组织 20261011133000_multi_device_sessions 模块的直属文件；具体契约由任务索引定位。 |
| [20261011140000_field_history_and_conflicts/](20261011140000_field_history_and_conflicts) | 本层组织 20261011140000_field_history_and_conflicts 模块的直属文件；具体契约由任务索引定位。 |
| [20261012101500_collaboration_foundation/](20261012101500_collaboration_foundation) | 本层组织 20261012101500_collaboration_foundation 模块的直属文件；具体契约由任务索引定位。 |
| [20261012110000_collaborators_and_notifications/](20261012110000_collaborators_and_notifications) | 本层组织 20261012110000_collaborators_and_notifications 模块的直属文件；具体契约由任务索引定位。 |
| [20261012120000_notification_payload/](20261012120000_notification_payload) | 本层组织 20261012120000_notification_payload 模块的直属文件；具体契约由任务索引定位。 |
| [20261012130000_share_links_and_referrals/](20261012130000_share_links_and_referrals) | 本层组织 20261012130000_share_links_and_referrals 模块的直属文件；具体契约由任务索引定位。 |
| [20261012140000_referral_generator/](20261012140000_referral_generator) | 本层组织 20261012140000_referral_generator 模块的直属文件；具体契约由任务索引定位。 |
| [20261012150000_referred_by/](20261012150000_referred_by) | 本层组织 20261012150000_referred_by 模块的直属文件；具体契约由任务索引定位。 |
| [20261012160000_restore_agreed_limits/](20261012160000_restore_agreed_limits) | 本层组织 20261012160000_restore_agreed_limits 模块的直属文件；具体契约由任务索引定位。 |
| [20261012170000_transaction_seq/](20261012170000_transaction_seq) | 本层组织 20261012170000_transaction_seq 模块的直属文件；具体契约由任务索引定位。 |
| [20261012190000_transaction_events/](20261012190000_transaction_events) | 本层组织 20261012190000_transaction_events 模块的直属文件；具体契约由任务索引定位。 |
| [20261013010000_book_messages/](20261013010000_book_messages) | 本层组织 20261013010000_book_messages 模块的直属文件；具体契约由任务索引定位。 |
| [20261013180000_remove_account_level_collaborators/](20261013180000_remove_account_level_collaborators) | 本层组织 20261013180000_remove_account_level_collaborators 模块的直属文件；具体契约由任务索引定位。 |
| [20261013190000_book_changed_event/](20261013190000_book_changed_event) | 本层组织 20261013190000_book_changed_event 模块的直属文件；具体契约由任务索引定位。 |
| [20261014110000_admin_grants/](20261014110000_admin_grants) | 本层组织 20261014110000_admin_grants 模块的直属文件；具体契约由任务索引定位。 |
| [20261014140000_admin_allowlist/](20261014140000_admin_allowlist) | 本层组织 20261014140000_admin_allowlist 模块的直属文件；具体契约由任务索引定位。 |
| [20261017160000_admin_console/](20261017160000_admin_console) | 本层组织 20261017160000_admin_console 模块的直属文件；具体契约由任务索引定位。 |
| [20261017223000_ledger_operation_logs/](20261017223000_ledger_operation_logs) | 本层组织 20261017223000_ledger_operation_logs 模块的直属文件；具体契约由任务索引定位。 |
| [20261018142000_consent_system/](20261018142000_consent_system) | 本层组织 20261018142000_consent_system 模块的直属文件；具体契约由任务索引定位。 |
| [20261018160000_lifecycle_system/](20261018160000_lifecycle_system) | 本层组织 20261018160000_lifecycle_system 模块的直属文件；具体契约由任务索引定位。 |
| [20261018163000_session_revocation/](20261018163000_session_revocation) | 本层组织 20261018163000_session_revocation 模块的直属文件；具体契约由任务索引定位。 |
| [20261018190000_critical_event_ledger/](20261018190000_critical_event_ledger) | 本层组织 20261018190000_critical_event_ledger 模块的直属文件；具体契约由任务索引定位。 |
| [20261018193000_critical_event_subject_width/](20261018193000_critical_event_subject_width) | 本层组织 20261018193000_critical_event_subject_width 模块的直属文件；具体契约由任务索引定位。 |
| [20261018194000_critical_event_batch_text/](20261018194000_critical_event_batch_text) | 本层组织 20261018194000_critical_event_batch_text 模块的直属文件；具体契约由任务索引定位。 |
| [20261018200000_critical_backup_checkpoints/](20261018200000_critical_backup_checkpoints) | 本层组织 20261018200000_critical_backup_checkpoints 模块的直属文件；具体契约由任务索引定位。 |
| [20261018201000_critical_operations/](20261018201000_critical_operations) | 本层组织 20261018201000_critical_operations 模块的直属文件；具体契约由任务索引定位。 |
| [20261018202000_critical_operation_idempotency/](20261018202000_critical_operation_idempotency) | 本层组织 20261018202000_critical_operation_idempotency 模块的直属文件；具体契约由任务索引定位。 |
| [20261018203000_critical_relay_retry_status/](20261018203000_critical_relay_retry_status) | 本层组织 20261018203000_critical_relay_retry_status 模块的直属文件；具体契约由任务索引定位。 |
| [20261018204000_critical_operation_receipt_expiry/](20261018204000_critical_operation_receipt_expiry) | 本层组织 20261018204000_critical_operation_receipt_expiry 模块的直属文件；具体契约由任务索引定位。 |
| [20261019020000_s14d_ledger_import/](20261019020000_s14d_ledger_import) | 本层组织 20261019020000_s14d_ledger_import 模块的直属文件；具体契约由任务索引定位。 |
| [20261019050000_s14d_import_jobs/](20261019050000_s14d_import_jobs) | 本层组织 20261019050000_s14d_import_jobs 模块的直属文件；具体契约由任务索引定位。 |
| [20261019110000_s14d_import_source_states/](20261019110000_s14d_import_source_states) | 本层组织 20261019110000_s14d_import_source_states 模块的直属文件；具体契约由任务索引定位。 |
| [20261019120000_s14d_import_source_namespace/](20261019120000_s14d_import_source_namespace) | 本层组织 20261019120000_s14d_import_source_namespace 模块的直属文件；具体契约由任务索引定位。 |
| [20261019150000_s14d_phase4_undo_locks/](20261019150000_s14d_phase4_undo_locks) | 本层组织 20261019150000_s14d_phase4_undo_locks 模块的直属文件；具体契约由任务索引定位。 |
| [20261019170000_s14d_phase4_lock_coverage/](20261019170000_s14d_phase4_lock_coverage) | 本层组织 20261019170000_s14d_phase4_lock_coverage 模块的直属文件；具体契约由任务索引定位。 |
| [20261021031459_s15e3_not_duplicate_relations/](20261021031459_s15e3_not_duplicate_relations) | 本层组织 20261021031459_s15e3_not_duplicate_relations 模块的直属文件；具体契约由任务索引定位。 |
| [20261025010000_user_avatar/](20261025010000_user_avatar) | 本层组织 20261025010000_user_avatar 模块的直属文件；具体契约由任务索引定位。 |
| [20261025030000_approved_avatar_ids/](20261025030000_approved_avatar_ids) | 本层组织 20261025030000_approved_avatar_ids 模块的直属文件；具体契约由任务索引定位。 |
| [20261025040000_daoxuan_avatar/](20261025040000_daoxuan_avatar) | 本层组织 20261025040000_daoxuan_avatar 模块的直属文件；具体契约由任务索引定位。 |
| [20261025050000_descent_avatar/](20261025050000_descent_avatar) | 本层组织 20261025050000_descent_avatar 模块的直属文件；具体契约由任务索引定位。 |
| [20261025130000_avatar_rewards/](20261025130000_avatar_rewards) | 本层组织 20261025130000_avatar_rewards 模块的直属文件；具体契约由任务索引定位。 |
| [20261026080000_message_quotes/](20261026080000_message_quotes) | 本层组织 20261026080000_message_quotes 模块的直属文件；具体契约由任务索引定位。 |
| [20261026120000_fx_public_rates/](20261026120000_fx_public_rates) | 本层组织 20261026120000_fx_public_rates 模块的直属文件；具体契约由任务索引定位。 |
| [20261026160000_classic_avatars_round_two/](20261026160000_classic_avatars_round_two) | 本层组织 20261026160000_classic_avatars_round_two 模块的直属文件；具体契约由任务索引定位。 |
| [20261028160000_halloween_avatar/](20261028160000_halloween_avatar) | 本层组织 20261028160000_halloween_avatar 模块的直属文件；具体契约由任务索引定位。 |
| [20261029040000_workbench_configuration/](20261029040000_workbench_configuration) | 本层组织 20261029040000_workbench_configuration 模块的直属文件；具体契约由任务索引定位。 |
| [20261029050000_category_hierarchy/](20261029050000_category_hierarchy) | 本层组织 20261029050000_category_hierarchy 模块的直属文件；具体契约由任务索引定位。 |
| [20261030120000_workbench_legacy_default_to_beginner/](20261030120000_workbench_legacy_default_to_beginner) | 本层组织 20261030120000_workbench_legacy_default_to_beginner 模块的直属文件；具体契约由任务索引定位。 |
| [20261101090000_entry_attachments_storage_notices/](20261101090000_entry_attachments_storage_notices) | 本层组织 20261101090000_entry_attachments_storage_notices 模块的直属文件；具体契约由任务索引定位。 |
| [20261101100000_storage_business_coverage/](20261101100000_storage_business_coverage) | 本层组织 20261101100000_storage_business_coverage 模块的直属文件；具体契约由任务索引定位。 |
| [20261101120000_storage_deltas_during_import/](20261101120000_storage_deltas_during_import) | 本层组织 20261101120000_storage_deltas_during_import 模块的直属文件；具体契约由任务索引定位。 |
<!-- directory-index:end -->
