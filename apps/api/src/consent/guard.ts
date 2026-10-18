import type { FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import { forbidden } from "../lib/errors.js";
import type { ConsentPolicy } from "./policy.js";

export interface ConsentRequirement {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  readonly contentHash: string;
}

/**
 * Wrap the session guard with the requirement to have accepted every currently required document.
 *
 * ⚠️ **One guard, not a parallel authorization path.** Business routes receive this wrapper instead
 * of the raw session guard, so a new route cannot accidentally omit the consent check by choosing
 * the other one. The account/consent/export routes receive the raw session guard on purpose: they
 * are the escape hatch a restricted account needs.
 */
export function createRequireConsent(
  prisma: PrismaClient,
  requireSession: (request: FastifyRequest) => Promise<void>,
  policy: ConsentPolicy,
  requirements: () => readonly ConsentRequirement[],
): (request: FastifyRequest) => Promise<void> {
  return async function requireConsent(request: FastifyRequest): Promise<void> {
    await requireSession(request);

    const required = requirements();
    if (required.length === 0) return;

    const userId = request.currentUser!.id;
    const accepted = await prisma.agreementAcceptance.findMany({
      where: {
        userId,
        OR: required.map((document) => ({
          documentId: document.id,
          documentVersion: document.version,
          contentHash: document.contentHash,
        })),
      },
      select: { documentId: true, documentVersion: true, contentHash: true },
    });

    const missing = required.filter(
      (document) =>
        !accepted.some(
          (row) =>
            row.documentId === document.id &&
            row.documentVersion === document.version &&
            row.contentHash === document.contentHash,
        ),
    );

    if (missing.length > 0) {
      throw forbidden(
        "agreement_required",
        "需要先确认当前适用的协议后才能继续使用在线功能。",
      );
    }
  };
}
