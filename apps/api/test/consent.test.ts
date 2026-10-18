import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_MAJOR_ANNOUNCEMENT } from "@libellum/shared";

import { createConsentPolicy } from "../src/consent/policy.js";
import { makeApp, prisma, resetDatabase } from "./support.js";

function cookieFrom(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") throw new Error("response did not set a cookie");
  return value.split(";")[0] ?? "";
}

async function makeAccountWithAgreements(app: FastifyInstance, username: string): Promise<string> {
  const legal = await app.inject({ method: "GET", url: "/api/v1/legal/documents" });
  const documents = (legal.json() as { documents: { id: string; version: string; contentHash: string }[] }).documents;
  const code = `INVITE-${username}`.toUpperCase();
  await prisma.registrationInvite.create({ data: { code, grantsAdmin: false } });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      inviteCode: code,
      username,
      displayName: username,
      password: "correct-horse-battery",
      agreements: documents.map((document) => ({
        documentId: document.id,
        documentVersion: document.version,
        contentHash: document.contentHash,
      })),
    },
  });

  expect(response.statusCode).toBe(201);
  return cookieFrom(response.headers);
}

describe("consent and major announcements", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = makeApp({ consentPolicy: createConsentPolicy(true) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("publishes the test legal document without authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/legal/documents" });
    expect(response.statusCode).toBe(200);
    const docs = (response.json() as { documents: { id: string; contentHash: string }[] }).documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const full = await app.inject({ method: "GET", url: `/api/v1/legal/documents/${docs[0]?.id ?? ""}` });
    expect(full.statusCode).toBe(200);
    expect((full.json() as { document: { paragraphs: string[] } }).document.paragraphs.length).toBeGreaterThan(1);
  });

  it("requires an agreement at registration and records the acceptance", async () => {
    await prisma.registrationInvite.create({ data: { code: "NOAGREE", grantsAdmin: false } });
    const noAgreement = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        inviteCode: "NOAGREE",
        username: "noagree",
        displayName: "No",
        password: "correct-horse-battery",
      },
    });
    expect(noAgreement.statusCode).toBe(400);
    expect(noAgreement.json()).toMatchObject({ code: "agreement_required" });

    const cookie = await makeAccountWithAgreements(app, "agreed_user");
    expect((await app.inject({ method: "GET", url: "/api/v1/ledger", headers: { cookie } })).statusCode).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: "agreed_user" } });
    expect(await prisma.agreementAcceptance.count({ where: { userId: user.id } })).toBe(1);
  });

  it("blocks ordinary business routes until an existing account accepts the current document", async () => {
    await prisma.registrationInvite.create({ data: { code: "LEGACY", grantsAdmin: false } });
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        inviteCode: "LEGACY",
        username: "legacy_user",
        displayName: "Legacy",
        password: "correct-horse-battery",
        // Simulate an account created before the document existed by registering with the
        // acceptance, then deleting the acceptance below.
        agreements: (await (async () => {
          const docs = await app.inject({ method: "GET", url: "/api/v1/legal/documents" });
          return (docs.json() as { documents: { id: string; version: string; contentHash: string }[] }).documents.map(
            (document) => ({
              documentId: document.id,
              documentVersion: document.version,
              contentHash: document.contentHash,
            }),
          );
        })()),
      },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = cookieFrom(registered.headers);
    await prisma.agreementAcceptance.deleteMany({});

    const blocked = await app.inject({ method: "GET", url: "/api/v1/ledger", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "agreement_required" });

    const status = await app.inject({ method: "GET", url: "/api/v1/account/consent", headers: { cookie } });
    expect(status.statusCode).toBe(200);
    const body = status.json() as { missingDocumentIds: string[]; requiredDocuments: { contentHash: string; id: string; version: string }[] };
    expect(body.missingDocumentIds).toHaveLength(1);

    const document = body.requiredDocuments[0]!;
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/account/agreements/accept",
      headers: { cookie },
      payload: {
        documentId: document.id,
        documentVersion: document.version,
        contentHash: document.contentHash,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/ledger", headers: { cookie } })).statusCode).toBe(200);
  });

  it("acknowledges a major announcement once per account and skips historical announcements for new accounts", async () => {
    const cookie = await makeAccountWithAgreements(app, "major_user");
    const user = await prisma.user.findUniqueOrThrow({ where: { username: "major_user" } });
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: new Date("2026-10-18T05:00:00.000Z") },
    });

    const before = await app.inject({ method: "GET", url: "/api/v1/account/consent", headers: { cookie } });
    expect((before.json() as { majorAnnouncement: { id: string } | null }).majorAnnouncement).toMatchObject({
      id: TEST_MAJOR_ANNOUNCEMENT.id,
    });

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/account/major-announcements/${TEST_MAJOR_ANNOUNCEMENT.id}/ack`,
      headers: { cookie },
      payload: { version: TEST_MAJOR_ANNOUNCEMENT.version, action: "acknowledged" },
    });
    expect(ack.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/v1/account/consent", headers: { cookie } });
    expect((after.json() as { majorAnnouncement: unknown }).majorAnnouncement).toBeNull();

    const newCookie = await makeAccountWithAgreements(app, "new_user");
    const newStatus = await app.inject({ method: "GET", url: "/api/v1/account/consent", headers: { cookie: newCookie } });
    expect((newStatus.json() as { majorAnnouncement: unknown }).majorAnnouncement).toBeNull();
  });

  it("publishes no required documents in the normal (production-like) policy", async () => {
    const plainApp = makeApp();
    await prisma.registrationInvite.create({ data: { code: "PLAIN", grantsAdmin: false } });
    const registered = await plainApp.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        inviteCode: "PLAIN",
        username: "plain_user",
        displayName: "Plain",
        password: "correct-horse-battery",
      },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = cookieFrom(registered.headers);

    const status = await plainApp.inject({
      method: "GET",
      url: "/api/v1/account/consent",
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      requiredDocuments: [],
      missingDocumentIds: [],
      majorAnnouncement: null,
    });
    await plainApp.close();
  });

  it("allows account export while the account is restricted", async () => {
    await makeAccountWithAgreements(app, "export_user");
    await prisma.agreementAcceptance.deleteMany({});
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "export_user", password: "correct-horse-battery" },
    });
    const cookie = cookieFrom(login.headers);

    const response = await app.inject({ method: "GET", url: "/api/v1/account/export", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { format: string; account: { username: string }; ledgers: unknown[] };
    expect(body.format).toBe("libevra-account-export/v1");
    expect(body.account.username).toBe("export_user");
    expect(Array.isArray(body.ledgers)).toBe(true);
  });
});
