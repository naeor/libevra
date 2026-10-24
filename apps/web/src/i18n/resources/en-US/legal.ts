import type { Messages } from "../../types.js";
import type zh from "../zh-CN/legal.js";

/** `legal` 文案（English）。必须与 zh-CN 的键结构完全一致。协议正文不翻译，见 zh-CN 文件头。 */
const legal: Messages<typeof zh> = {
  chineseOnly:
    "This document is available in Chinese only. The Chinese version is the one that applies; an English translation is under review.",
  placeholder: {
    mustCover: "What the final text needs to cover",
    pending: "The final text is still being prepared and will replace this page when it’s ready.",
    privacy: {
      title: "Privacy Policy",
      lede: "A formal privacy policy hasn’t been published yet. This page only lists open questions; it is not a policy.",
      questions: {
        storage: "Where entries, notes, photos and voice recordings are stored, for how long, and who runs the servers that hold them.",
        recognition:
          "Whether photo and voice recognition happen on the device or on a server — and if data is sent, what is sent and whether it’s kept.",
        logs:
          "What diagnostic logs record. The current design doesn’t log amounts, notes or image content; this needs to be verified item by item before it goes into the policy.",
        exportDelete: "How to export and delete data, and what happens to each kind of data when an account is closed.",
        cookies:
          "What cookies and local storage are used for. The session cookie is required; other local storage is used for the offline cache and display preferences.",
        thirdParty:
          "Whether any third-party services are used. There are currently no statistics, advertising or analytics services; if any are added, this section must be updated.",
      },
    },
    terms: {
      title: "Terms of Use",
      lede: "Formal terms of use haven’t been published yet. This page only lists open questions; it is not the terms.",
      questions: {
        service: "How the service is provided (self-hosted or hosted), and whether any availability is promised.",
        accounts: "How accounts and invite codes are issued, how long they’re valid, and what happens if they’re misused.",
        sharing: "Who owns the data in a shared ledger: who can see it, who can change it, and what each member keeps after leaving.",
        backup: "Where responsibility for backups and data loss begins and ends.",
        license: "How the open-source license (AGPL-3.0) relates to the terms of use.",
        termination: "How people can get their data back if the service changes or shuts down.",
      },
    },
  },
  document: {
    fallbackTitle: "Agreement",
    unavailable: "This document isn’t available right now.",
    notFound: "We couldn’t find this document. It may not be published yet, or the link may be wrong.",
    testOnly: "This is a local test document. It is not a legal document and is only used to test the agreement flow.",
    meta: "Document ID: {{id}} · Version: {{version}}",
  },
  consent: {
    documentVersion: "Version {{version}}",
    accept: "Agree and continue",
    decline: "Not now",
    viewFull: "Read the full document",
    agree: "I have read and agree to this document.",
    processing: "Working…",
    majorEyebrow: "Important update · {{version}}",
    closeMajor: "Close important update",
    gotIt: "Got it",
    viewDetails: "View details",
    exportCancelled: "Export canceled.",
    exportDone: "Your account data has been exported. The file contains your profile and every entry in the ledgers you can access.",
    help: {
      title: "If you don’t agree yet",
      eyebrow: "Your account and data",
      signOut: "Sign out",
      backToAgreement: "Back to the agreement",
      intro: "You can export or deal with your account data first and decide later.",
      export: "Export my data",
      deleteTitle: "Delete data stored on the server",
      deleteBody:
        "You first need to leave, handle or archive each ledger. Open Your data to review the impact ledger by ledger and confirm.",
      closeTitle: "Close account",
      closeBody:
        "Closing your account ends all sessions, blocks signing in again, and handles each ledger’s data under its archive/delete rules. Archived ledgers can be kept for a limited time, with a one-time recovery credential.",
      openAccountData: "Open Your data",
      localNote:
        "Deleting data or closing your account affects data on the server. Offline copies on this device are cleared once that’s done; entries that haven’t synced are never treated as deleted without warning you.",
      viewAgreement: "View agreement",
    },
  },
};

export default legal;
