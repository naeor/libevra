import type { Messages } from "../../types.js";
import type zh from "../zh-CN/ledgerImport.js";

/**
 * `ledgerImport` 文案（English）。必须与 zh-CN 的键结构完全一致。
 *
 * ⚠️ 高风险流程：英文不弱化任何警告，后果、时限（确认窗口、自动撤销）与“可恢复 / 永久删除”都要写明。
 * 术语：来源账本 Source ledger、目标账本 Target ledger、游客账本 Guest ledger、正式账本 Account ledger、
 * 撤销 Undo、弃置 Retire、冲突 Conflict。
 */
const ledgerImport: Messages<typeof zh> = {
  title: "Import ledger",
  subtitle: {
    select:
      "Import this device’s guest ledger, or another account ledger that only you use, into a target ledger. First choose the source and the target.",
    preview: "Check the direction, mapping and possible duplicates. Previewing and reviewing don’t change any ledger.",
    review:
      "Review source changes and possible duplicates. Only target entries you explicitly choose to update will change — the import never silently overwrites anything.",
    jobActive:
      "The import is running on the server. Closing this page won’t stop it; reopen it to see the actual progress.",
    confirm: "Nothing is written until you confirm the final summary. The source ledger’s data is kept.",
  },
  badge: {
    done: "Completed",
    guest: "Guest source",
    formal: "Ledger source",
    choose: "Choose source",
  },
  steps: {
    aria: "Import steps",
    select: "Choose",
    preview: "Preview",
    review: "Review",
    confirm: "Confirm",
  },
  count: {
    entries_one: "{{count}} entry",
    entries_other: "{{count}} entries",
    records_one: "{{count}} entry",
    records_other: "{{count}} entries",
    groups_one: "{{count}} group",
    groups_other: "{{count}} groups",
    batches_one: "{{count}} batch",
    batches_other: "{{count}} batches",
    guestEntries_one: "{{count}} guest entry",
    guestEntries_other: "{{count}} guest entries",
    sourceEntries_one: "{{count}} source entry",
    sourceEntries_other: "{{count}} source entries",
    targetEntries_one: "{{count}} target entry",
    targetEntries_other: "{{count}} target entries",
  },
  metricValue: {
    entries_one: "{{count}}",
    entries_other: "{{count}}",
    groups_one: "{{count}}",
    groups_other: "{{count}}",
  },
  bookNumber: "No. {{number}}",
  //  ：窄屏换行时“Income”与金额不被拆开。
  totals: "Expense {{expense}} · Income {{income}}",
  checking: "Checking…",
  message: {
    undone: "The import was undone. The entries, categories and source status it changed have been restored.",
    undoFailed: "Undo failed. The ledger is still locked — you can try undoing again.",
    noGuest: "There’s no guest ledger on this device.",
    resultMismatch:
      "The server finished the import, but the result doesn’t match what was expected. Take a screenshot of this page and check the target ledger. Don’t submit again.",
    incrementalUnavailable:
      "Couldn’t read the history of earlier imports, so the import hasn’t started. Refresh and try again.",
    otherAccount: "This import belongs to a different account. Sign in to that account to keep checking it.",
    waitExtended: "Waiting time extended. Automatic progress checks don’t extend the deadline.",
    chooseSource: "Choose a source ledger.",
    formalNeedsTarget: "When the source is an account ledger, choose a different existing account ledger as the target.",
    chooseTarget: "Choose a target ledger.",
    newNameRequired: "Enter a name for the new ledger.",
  },
  jobError: {
    book_lock_conflict:
      "After a restart, the ledger lock didn’t match this import, so it was paused. It will be safely undone when time runs out.",
    legacy_import_requires_repreview:
      "This is an older batch import. Preview again and start a new import that can be undone.",
    job_cancelled_legacy:
      "This older import was cancelled. Batches already submitted were kept; entries not yet submitted weren’t written.",
    import_stalled:
      "The import made no progress for too long and was paused. It will be safely undone automatically when time runs out.",
    confirm_stalled:
      "Final confirmation timed out, so the import is waiting for confirmation again. You can retry finishing it or undo it.",
    job_expired:
      "The import was paused past its recovery deadline and the source snapshot was cleared. Imported entries won’t be deleted, but this import can’t continue.",
    generic: "Something went wrong with this import. Refresh the progress, then resume or undo it.",
  },
  removalDialog: {
    title: "Delete the selected target entries and import?",
    descriptionFallback:
      "This import will delete the target entries you chose to remove. You can restore them from edit history.",
    description: "This will delete {{removed}} and import {{imported}}.",
    consequence: {
      onlyMarked: "Only target entries you marked “Remove” on the review step are deleted",
      restorable:
        "Removed entries can be restored from edit history with the same numbers, as long as the ledger still exists and you can edit it",
      sourceKept: "Nothing in the source ledger is deleted",
      atomic:
        "If this import fails, everything is put back — target entries are never deleted without the source entries being imported",
    },
    confirm: "Delete and import",
  },
  undoDialog: {
    title: "Undo this import?",
    description: "Undoing reverses the changes this import has already made — it doesn’t just stop the rest of it.",
    consequence: {
      targetReverted: "Entries this import added to the target are removed, and entries it updated go back to their previous values",
      stateReverted: "Categories, tags, source status and import results it wrote go back to how they were before the import",
      othersKept: "Other ledgers, and offline changes on other devices that are waiting to sync, aren’t deleted",
      failureLocked: "If the undo fails, the ledger stays locked for editing and this page shows the failure",
      editAfter: "You can edit this ledger again only after the undo finishes",
    },
    confirm: "Undo import",
    progress: "{{batches}} submitted — {{added}} added and {{updated}} updated. All of these changes will be reversed exactly.",
  },
  finishDialog: {
    title: "Finish this import?",
    description: "Once you finish, this import can’t be undone.",
    consequence: {
      serverChecks: "The server checks the final result and saves an import record",
      removalsApplied: "Target entries you chose to remove are deleted at this point",
      unlocks: "Once it’s finished, the ledger can be edited again",
      cleanupAfter: "Only after finishing can you clean up migrated guest entries or retire the source ledger",
      failureWaits: "If finishing fails, the import keeps waiting for confirmation and the ledger stays locked for editing",
    },
    confirm: "Finish import",
  },
  job: {
    title: "Undoable import",
    status: {
      queued: "Queued",
      running: "Importing…",
      finalizing: "Checking final totals…",
      awaiting_confirmation: "All batches done — waiting for your final confirmation",
      confirming: "Finishing…",
      confirmed: "Finished",
      undoing: "Safely undoing…",
      undone: "Undone",
      undo_failed: "Undo failed — the ledger stays locked",
      paused: "Paused",
      failed: "Needs attention",
      completed: "Completed (older import)",
      cancelled: "Cancelled (older import)",
      expired: "Expired — the source snapshot has been cleared",
    },
    batchBadge: "{{done}} / {{batches}}",
    progress:
      "Processed {{done}} of {{batches}}: {{added}} added · {{updated}} updated · {{skipped}} skipped. {{total}} from the source in total.",
    lockNote:
      "Until you finish the import, this ledger is locked for editing — on other devices too. Undoing the import reverses the changes already made; it doesn’t just stop the rest.",
    waiting: "Waiting for confirmation.",
    countdown:
      "Finish or undo within {{minutes}} min {{seconds}} sec. If time runs out, the import is safely undone automatically.",
    pausedCountdown_one:
      "Paused. If time runs out, the import is safely undone automatically (about {{count}} second left). You can resume it first.",
    pausedCountdown_other:
      "Paused. If time runs out, the import is safely undone automatically (about {{count}} seconds left). You can resume it first.",
    undoableBatches_one:
      "The {{count}} batch already submitted can be fully undone. The ledger won’t be unlocked before the undo.",
    undoableBatches_other:
      "The {{count}} batches already submitted can be fully undone. The ledger won’t be unlocked before the undo.",
    undoFailed:
      "The undo didn’t finish, so the ledger is still locked. Try undoing again. A failed undo is never shown as a success, and the ledger is never simply unlocked.",
    undone: "Everything this import added or updated, and the source status, has been restored. The ledger is unlocked.",
    expired:
      "This older import was paused past its recovery deadline and its source snapshot was cleared. Entries already imported are kept.",
    action: {
      refresh: "Refresh progress",
      keepWaiting: "I’m still here — wait longer",
      resuming: "Resuming…",
      resume: "Resume import",
      finish: "Finish import",
      retryUndo: "Retry undo",
      undo: "Undo this import",
    },
  },
  pending: {
    title: "An import hasn’t confirmed its result yet",
    body: "{{source}} → {{target}}. Continuing only checks with the server using the same import ID — no entries will be created twice.",
    resume: "Check the result",
    drop: "Discard on this device",
    dropNote: "Discarding only clears the record on this device. It doesn’t delete entries that were already imported.",
  },
  recovery: {
    message: {
      partial: "Some of your choices were restored. Entries that changed need to be reviewed again.",
      restored: "Your earlier choices were restored. Please check the whole confirmation page again.",
      mappingReset: "Some mapping choices couldn’t be safely restored. Entries that changed need to be reviewed again.",
    },
    restoredGroups_one: "Restored the decision for {{count}} duplicate group",
    restoredGroups_other: "Restored the decisions for {{count}} duplicate groups",
    resetGroups_one: "; {{count}} group needs another review",
    resetGroups_other: "; {{count}} groups need another review",
    restoredConflicts_one: "; restored {{count}} mapping choice",
    restoredConflicts_other: "; restored {{count}} mapping choices",
    resetConflicts_one: "; {{count}} mapping needs to be chosen again",
    resetConflicts_other: "; {{count}} mappings need to be chosen again",
    end: ".",
    highlighted: "Affected groups are highlighted on the review step.",
  },
  select: {
    sourceLabel: "Source ledger",
    targetLabel: "Target ledger",
    // 这几条显示在单行下拉触发器里（超长会被截断），英文刻意写短；账本名放前面，截断时先截掉说明。
    sourcePlaceholder: "Choose a source",
    targetPlaceholder: "Choose a target",
    guestOption: "Local guest ledger",
    formalOption: "{{name}} · Account ledger",
    sameAsSource: "Same as the source — can’t be chosen",
    noSources: "There’s no guest ledger on this device, and no other ledger that only you use to import from.",
    formalSourceNote:
      "From an account ledger, only the entries you confirm in the preview are imported. Nothing in the source ledger is deleted, and the source ledger isn’t closed.",
    guestSourceNote:
      "Guest data isn’t read or sent until you upload it, and it isn’t deleted automatically after the import.",
    formalTargetNote:
      "An account ledger can only be imported into another existing account ledger that only you use. You can’t create a new target ledger or choose the source itself.",
    createTargetFirst:
      "Importing doesn’t create a target ledger. First create an empty ledger as usual in <link>Your ledgers</link>, then come back and choose it as the target.",
    importInto: "Importing into “{{name}}” · {{account}}",
    importIntoWithNumber: "Importing into “{{name}}” · {{account}} · No. {{number}}",
    accountFallback: "Your account",
    continue: "See preview",
    rules:
      "You can import from this device’s guest ledger or from another ledger in your account that only you use. For an account ledger, both ledgers must have you as their only active member, with no pending invites or active share links. This is checked at preview and again on import. Importing never deletes or empties the source ledger.",
  },
  preview: {
    direction: "Direction",
    guestNote: "The source is this device’s guest ledger. Its data stays on this device after the import.",
    formalNote:
      "The source is an account ledger that only you use. Its data is kept after the import and isn’t deleted or closed automatically.",
    whatHappens: "What this import will do",
    metric: {
      source: "Source entries",
      clean: "Conflict-free",
      groups: "Duplicate groups",
    },
    noEntries: "The source has no entries.",
    targetExisting_one:
      "The target ledger already has {{count}} entry. The import won’t overwrite it. If it would be deleted or moved, it’s listed on the review step for you to confirm again.",
    targetExisting_other:
      "The target ledger already has {{count}} entries. The import won’t overwrite them. Any that would be deleted or moved are listed one by one on the review step for you to confirm again.",
    sourceDeleted_one: "{{count}} deleted entry in the source won’t be imported.",
    sourceDeleted_other: "{{count}} deleted entries in the source won’t be imported.",
    taxonomyTitle: "Categories, payment methods & tags",
    pendingConflicts_one: "{{count}} to confirm",
    pendingConflicts_other: "{{count}} to confirm",
    viewDetails: "View details",
    mappingLabel: {
      category: "Categories",
      paymentMethod: "Payment methods",
      tag: "Tags",
    },
    mappingRow: "{{reuse}} reused · {{create}} new",
    noConflicts: "Nothing shares a name with different settings.",
    duplicatesTitle: "Possible duplicates",
    duplicatesNote:
      "Only entries in the source and target ledgers are compared. After reviewing, you decide whether to skip them or keep both.",
    reviewGroups_one: "Review {{count}} duplicate group",
    reviewGroups_other: "Review {{count}} duplicate groups",
    reviewIncremental: "Review earlier imports and source changes",
    noDuplicates: "No possible duplicates found.",
    resolveConflictsFirst: "Resolve every conflict above before continuing.",
    reviewDuplicatesButton: "Review possible duplicates",
    reviewIncrementalButton: "Review changes since the last import",
    continue: "Continue",
    chooseAgain: "Choose again",
  },
  conflict: {
    type: {
      category: "Category",
      paymentMethod: "Payment method",
      tag: "Tag",
    },
    title: "{{type}} “{{source}}” has the same name as “{{target}}” in the target, but different settings",
    aria: "Resolve the conflict for {{name}}",
    reuse: "Reuse the target’s",
    create: "Add a copy from the source",
    reason: {
      categorySystem:
        "The custom category “{{name}}” in the source has the same name as a system category in the target, so it can’t be reused directly.",
      categorySourceArchived: "Source category “{{name}}” is archived, but the target category with the same name isn’t.",
      categoryTargetArchived: "Source category “{{name}}” isn’t archived, but the target category with the same name is.",
      paymentSourceArchived:
        "Source payment method “{{name}}” is archived, but the target payment method with the same name isn’t.",
      paymentTargetArchived:
        "Source payment method “{{name}}” isn’t archived, but the target payment method with the same name is.",
      tagColor:
        "Source tag “{{name}}” has a different color from the target tag with the same name. Reusing the target’s tag drops the source color.",
    },
  },
  incremental: {
    status: {
      new: "New",
      unchanged: "Imported, unchanged",
      modified: "Changed in source",
      target_changed: "Changed in target",
      target_deleted: "Deleted in target",
      previously_skipped: "Skipped before",
      previously_skipped_modified: "Skipped before, changed in source",
      needs_review: "Older import needs checking",
    },
    unknownCategory: "Unknown category",
    title: "Earlier imports",
    note:
      "Entries already imported and unchanged are skipped by default. Source changes only update the target if you explicitly choose to. Entries deleted in the source aren’t deleted from the target.",
    chip: {
      unchanged: "Unchanged {{number}}",
      new: "New {{number}}",
      modified: "Changed {{number}}",
      targetChanged: "Target changed {{number}}",
      targetDeleted: "Target deleted {{number}}",
      previouslySkipped: "Skipped before {{number}}",
      needsReview: "To check {{number}}",
    },
    legacy_one:
      "{{count}} entry from an older import has no stable source ledger identity, so it can’t be confirmed as coming from this guest ledger. By default only the target is kept — nothing is silently overwritten or linked for deletion.",
    legacy_other:
      "{{count}} entries from older imports have no stable source ledger identity, so they can’t be confirmed as coming from this guest ledger. By default only the target is kept — nothing is silently overwritten or linked for deletion.",
    noChanges: "No source changes need to be handled one by one.",
    legacyBadge: "Older import",
    sourceFacts: "Source: {{facts}}",
    targetFacts: "Target: {{facts}}",
    noTarget: "Target: no matching entry (nothing will be created or deleted automatically)",
    keepTarget: "Keep target",
    updateTarget: "Update target from source",
    targetChangedLocked: "Target has changed — can’t overwrite it directly",
    legacyLocked: "Older entry not confirmed — can’t overwrite it directly",
    keepSkipped: "Keep skipped",
    importNow: "Import this time",
    protectNote:
      "To protect existing data, this import only keeps the target — nothing is overwritten, restored or deleted. If you need to change it, check it manually in the target ledger first.",
  },
  retention: {
    title: "Source safety & cleanup",
    intro:
      "A successful import doesn’t mean the source can be cleaned up automatically. Everything here is separate and manual, and keeps data by default. Entries that weren’t migrated are never cleaned up or retired.",
    guest: {
      title: "The guest source ledger is still on this device",
      note:
        "Importing doesn’t delete guest data automatically. You can check which entries are confirmed as migrated to the target. Entries that weren’t migrated, were skipped, have changed or failed the target check are kept.",
      nothingToClean: "Nothing can be safely cleaned up. Entries that weren’t migrated are kept by default.",
      cleaned:
        "Cleaned up {{removed}} confirmed as migrated. Still in the source: {{remaining}}. The cleanup is saved on this device and can be restored.",
      restored_one: "Restored {{count}} cleaned-up entry to the guest ledger.",
      restored_other: "Restored {{count}} cleaned-up entries to the guest ledger.",
      preview: "{{cleanable}} can be cleaned up and {{retained}} will be kept ({{total}} in the source).",
      check: "Check what can be cleaned up",
      clean_one: "Clean up {{count}} entry",
      clean_other: "Clean up {{count}} entries",
      restore: "Restore cleaned-up entries ({{number}})",
    },
    formal: {
      title: "The account source ledger is kept in full by default",
      note:
        "After the import, you can separately choose whether to retire the source ledger. Once retired, its data is kept for a while and can be restored before the recovery deadline.",
      archived: "The source ledger has been retired. You can see its recovery deadline and restore it on the archive recovery page.",
      counts:
        "Source “{{name}}”: {{migrated}} confirmed in the target, {{unmigrated}} not confirmed as migrated ({{total}} in total).",
      archivedInfo: "Archived. Self-restore deadline: {{restoreUntil}}. Scheduled permanent deletion: {{purgeAt}}.",
      none: "None",
      unmigratedWarning:
        "Some source entries aren’t confirmed as migrated. Retiring won’t delete them, but you’ll need to restore the source ledger to see them.",
      check: "Check source ledger options",
      archive: "Retire source ledger (keeps data)",
    },
    reason: {
      allMigrated:
        "This source ledger can be retired now, and every entry in it can be found in the target ledger. After retiring, you can still restore it before the recovery deadline.",
      someUnmigrated:
        "This source ledger can be retired now, but some of its entries weren’t migrated to the target ledger. Retiring won’t delete them, but you’ll need to restore the source to see them.",
      blocked:
        "This source ledger can’t be retired right now (it may have other members, active invites or share links, already be archived, or have a pending recovery request).",
    },
    guestDialog: {
      title: "Clean up migrated guest entries?",
      description:
        "Only guest entries the server has confirmed as migrated to the target are cleaned up. Local storage isn’t wiped, and entries that weren’t migrated aren’t deleted.",
      consequence: {
        movedToArchive:
          "The confirmed entries in the guest ledger on this device move to a cleanup record on this device, and can be restored",
        othersKept: "Entries that weren’t migrated, were skipped, have changed or failed the target check are kept",
        nothingWiped: "Other guest ledgers, the offline queue, categories and settings aren’t cleared",
        noRepeat: "Entries already cleaned up won’t be processed again",
      },
      confirm: "Clean up migrated entries",
    },
    archiveDialog: {
      titleUnmigrated: "Some source entries aren’t confirmed as migrated. Retire the source anyway?",
      title: "Retire the source ledger?",
      description: "After retiring, the source data is kept for a while and can be restored before the recovery deadline.",
      consequence: {
        unmigrated_one:
          "{{count}} source entry isn’t confirmed as migrated to the target. Retiring won’t delete it, but you’ll need to restore the source to see it",
        unmigrated_other:
          "{{count}} source entries aren’t confirmed as migrated to the target. Retiring won’t delete them, but you’ll need to restore the source to see them",
        allMigrated: "Every entry in the source ledger can be found in the target ledger",
        kept: "After retiring, the source data stays on the server and can be restored before the recovery deadline",
        noPurge: "Nothing is permanently deleted now, and no backups are deleted",
        purgeLater:
          "After the recovery deadline, the source ledger is permanently deleted as scheduled and can’t be restored",
      },
      confirmUnmigrated: "I understand — retire the source anyway",
      confirm: "Retire source ledger",
    },
  },
  review: {
    noGroups: "No duplicate groups to review.",
    continue: "Continue",
    backToPreview: "Back to preview",
    title: "Possible duplicates",
    counts: "Source: {{source}} · Target: {{target}}",
    previousGroup: "Previous group",
    nextGroup: "Next group",
    previousShort: "Previous",
    nextShort: "Next",
    changed: "This group changed after the preview was reloaded. Review it again.",
    quickTitle: "Quick picks",
    quickNote:
      "These only fill in the choices below — nothing is deleted directly. Check whether to keep or remove each entry in the target ledger.",
    preset: {
      keep_a: { label: "Keep target", hint: "Skip source, keep target" },
      keep_b: { label: "Keep source", hint: "Import source, remove target" },
      keep_both: { label: "Keep both", hint: "Import source, keep target" },
      keep_neither: { label: "Keep neither", hint: "Skip source, remove target" },
    },
    sourceHeading: "Source ledger",
    sourceChoices: "Import / Skip",
    targetHeading: "Target ledger",
    targetChoices: "Keep / Remove (restorable)",
    sourceAria: "Source entry: {{name}}",
    targetAria: "Target entry: {{name}}",
    option: {
      import: "Import",
      skip: "Skip",
      keep: "Keep",
      remove: "Remove (restorable)",
    },
    summary: {
      importAllKeepAll: "All source entries will be imported and all target entries kept.",
      skipAllRemoveAll: "All source entries will be skipped and all target entries removed.",
      skipAllKeepAll: "All source entries will be skipped and all target entries kept.",
      mixed:
        "From the source: import {{imported}}, skip {{skipped}}. In the target ledger: keep {{kept}}, delete {{removed}}.",
    },
    chooseEach: "Choose what to do with every source and target entry before continuing.",
    removalReminder_one:
      "The {{count}} target entry to be deleted will be listed again at final confirmation. Check it carefully.",
    removalReminder_other:
      "The {{count}} target entries to be deleted will be listed again at final confirmation. Check each one.",
    undecided_one: "{{count}} group still undecided",
    undecided_other: "{{count}} groups still undecided",
  },
  confirm: {
    finalTitle: "Final confirmation",
    createAndImport: "Create a new ledger and import",
    importInto: "Import into “{{name}}”",
    route: "Source: {{source}} · Target: {{target}}",
    metric: {
      import: "To import",
      skip: "Skipped",
      remove: "To delete",
    },
    taxonomy:
      "Categories, payment methods & tags: {{reuse}} reused · {{create}} new. Same-name conflicts were handled as you chose.",
    byCurrency: "By currency",
    nothingToImport: "No entries to import.",
    noRemovals:
      "This import won’t delete any existing entries in the target ledger. New entries get their numbers from the server. The source ledger’s data isn’t deleted automatically after a successful import either.",
    removalsSummary_one: "{{count}} target entry will be deleted (expand to check)",
    removalsSummary_other: "{{count}} target entries will be deleted (expand to check)",
    removalsNote:
      "Only the entries listed above are deleted. They can be restored from edit history and aren’t deleted permanently. The source ledger isn’t affected.",
    deleteAndImport: "Delete and import",
    start: "Start import",
    backToReview: "Back to review",
    submittingTitle: "Importing…",
    submittingBody_one:
      "Checking target permissions, writing {{count}} entry and checking the result. Please don’t close this page.",
    submittingBody_other:
      "Checking target permissions, writing {{count}} entries and checking the result. Please don’t close this page.",
    submittingNote: "Each import runs only once. If your connection drops, use “Check the result” to confirm.",
    pausedEyebrow: "Import paused",
    errorEyebrow: "Import didn’t finish",
    pausedTitle: "It’s safe to retry",
    errorTitle: "Needs another review",
    pausedBody:
      "The server may have finished, or may not have started yet. Checking again with the same import ID won’t create entries twice.",
    errorBody: "Nothing was written to the target ledger this time. Go back to the preview, confirm again, then start.",
    checkResult: "Check the result",
  },
  result: {
    eyebrow: "Import complete",
    imported_one: "Imported {{count}} entry",
    imported_other: "Imported {{count}} entries",
    updated_one: "Also updated {{count}} existing target entry, as you explicitly chose.",
    updated_other: "Also updated {{count}} existing target entries, as you explicitly chose.",
    into: "Into “{{name}}”",
    intoWithNumber: "Into “{{name}}” · No. {{number}}",
    createdSuffix: " (created for this import)",
    skipped_one: "Skipped {{count}} source entry, as you chose during review.",
    skipped_other: "Skipped {{count}} source entries, as you chose during review.",
    removed_one:
      "Deleted {{count}} target entry, as you chose. You can restore it from edit history, as long as the ledger still exists and you can edit it.",
    removed_other:
      "Deleted {{count}} target entries, as you chose. You can restore them one by one from edit history, as long as the ledger still exists and you can edit it.",
    checkTitle: "Result check",
    row: {
      source: "Source entries",
      imported: "Imported",
      updated: "Updated existing",
      skipped: "Skipped",
      removed: "Target entries deleted",
      target: "Target entries",
    },
    targetChange: "{{before}} → {{after}}",
    byCurrency: "By currency (currencies are never added together)",
    currencyTotals: "{{currency}}: Expense {{expense}} · Income {{income}}",
    serverChecked:
      "The server checked these numbers against what was actually written. The source ledger’s data is still kept and won’t be deleted automatically.",
    openTarget: "Open target ledger",
    done: "Done",
  },
  warning: {
    sourceDeleted_one: "The source ledger has {{count}} deleted entry, which won’t be imported.",
    sourceDeleted_other: "The source ledger has {{count}} deleted entries, which won’t be imported.",
    conflicts_one:
      "{{count}} category, payment method or tag shares a name with the target but has different settings. Confirm it before importing; until you choose, the preview assumes “Reuse the target’s”.",
    conflicts_other:
      "{{count}} categories, payment methods or tags share a name with the target but have different settings. Confirm each one before importing; until you choose, the preview assumes “Reuse the target’s”.",
    duplicates:
      "Found {{groups}} of possible duplicates ({{source}} in the source, {{target}} in the target). Review each group before anything is written.",
    targetExisting_one:
      "The target ledger already has {{count}} entry. The import only adds entries or handles duplicates the way you choose — it never silently changes existing ones.",
    targetExisting_other:
      "The target ledger already has {{count}} entries. The import only adds entries or handles duplicates the way you choose — it never silently changes existing ones.",
    guest:
      "This is the guest ledger on this device. Neither the preview nor the import deletes guest data automatically; cleanup is a separate step.",
  },
  submitError: {
    noMapping: "A source item has no mapping.",
    missingSourceFingerprint: "The preview is missing server data for the source. Preview again.",
    unresolvedGroups: "Some duplicate groups haven’t been handled yet.",
    formalToNew: "An account ledger can’t be imported into a new ledger.",
    missingTargetFingerprint: "The preview is missing server data for the target. Preview again.",
    missingGuestSource: "The guest source snapshot is missing.",
  },
  unknown: {
    category: "(Unknown category)",
    tag: "(Unknown tag)",
  },
};

export default ledgerImport;
