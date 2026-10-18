import { createHash } from "node:crypto";

import {
  activeLegalDocuments,
  type LegalDocument,
  type MajorAnnouncement,
  activeMajorAnnouncements,
} from "@libellum/shared";

/**
 * Consent policy for one API process.
 *
 * Local development includes the clearly marked test agreement and test major announcement so the
 * complete flow can be exercised. Tests and production exclude them unless explicitly enabled.
 */
export interface ConsentPolicy {
  readonly includeTest: boolean;
  readonly documents: readonly LegalDocument[];
  readonly majorAnnouncements: readonly MajorAnnouncement[];
}

export function createConsentPolicy(includeTest: boolean): ConsentPolicy {
  return {
    includeTest,
    documents: activeLegalDocuments(includeTest),
    majorAnnouncements: activeMajorAnnouncements(includeTest),
  };
}

/** The hash of the exact visible text that a user is asked to accept. */
export function legalContentHash(document: LegalDocument): string {
  return createHash("sha256").update(document.paragraphs.join("\n\n"), "utf8").digest("hex");
}

export function documentWithHash(document: LegalDocument): LegalDocument & { readonly contentHash: string } {
  return { ...document, contentHash: legalContentHash(document) };
}

export function requiredDocuments(
  policy: ConsentPolicy,
): readonly (LegalDocument & { readonly contentHash: string })[] {
  return policy.documents.filter((document) => document.requiresAcceptance).map(documentWithHash);
}
