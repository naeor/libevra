import {
  INVITE_REJECTION_CODE,
  INVITE_REJECTION_MESSAGE,
  authResponseSchema,
  changePasswordRequestSchema,
  currencySchema,
  loginRequestSchema,
  meResponseSchema,
  recoverRequestSchema,
  recoveryCodeResponseSchema,
  regenerateRecoveryCodeRequestSchema,
  registerRequestSchema,
  registrationConfigResponseSchema,
  rejectInvite,
  type RegistrationMode,
  type SessionUser,
  updatePreferencesRequestSchema,
  updateProfileRequestSchema,
} from "@libellum/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createRequireAuth } from "../auth/guard.js";
import { LoginThrottle } from "../auth/login-throttle.js";
import { getDummyHash, hashPassword, verifyPassword } from "../auth/password.js";
import { confirmP0 } from "../critical/confirm.js";
import { recordCriticalEvent } from "../critical/store.js";
import {
  generateRecoveryCode,
  takeNextAccountNumber,
  normalizeRecoveryCode,
} from "../auth/recovery-code.js";
import { requiredDocuments, type ConsentPolicy } from "../consent/policy.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFrom,
} from "../auth/session.js";
import type { PrismaClient } from "../db.js";
import { recordReferral } from "../collab/referral.js";
import { createDefaultLedger } from "../ledger/bootstrap.js";
import { defaultBookNameFor } from "../ledger/defaultName.js";
import { badRequest, conflict, tooManyRequests, unauthorized } from "../lib/errors.js";
import {
  assertAvatarSelectable,
  readTimeZoneHeader,
  runAvatarRewardCheck,
} from "../rewards/service.js";

export interface AuthRouteOptions {
  readonly prisma: PrismaClient;
  readonly throttle: LoginThrottle;
  /** Set the cookie's Secure flag (true in production, false on http://localhost). */
  readonly cookieSecure: boolean;
  /** Current agreement policy; it is empty in production until real documents are published. */
  readonly consentPolicy: ConsentPolicy;
  /**
   * Whether signup requires an invite code (S14-A).
   *
   * ⚠️ **The server is the judge, not the page.** The public config endpoint below exists so the
   * interface can show the right form; the register handler re-checks this value and refuses a
   * body without a code when the mode is `invite`, so hiding the field can never relax the rule.
   */
  readonly registrationMode: RegistrationMode;
}

interface RequestMeta {
  readonly userAgent: string | undefined;
  readonly ipAddress: string | undefined;
}

type UserRow = {
  id: string;
  accountNumber: string;
  username: string;
  displayName: string;
  avatarId: string;
  isDemo: boolean;
  defaultCurrency: string;
  createdAt: Date;
};

function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    accountNumber: user.accountNumber,
    username: user.username,
    displayName: user.displayName,
    avatarId: user.avatarId,
    isDemo: user.isDemo,
    // See the guard: the column type is wider than the supported set, and only
    // a manual database edit could put anything else in it.
    defaultCurrency: currencySchema.catch("CNY").parse(user.defaultCurrency),
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Account numbers are unique and now allocated from a server-owned counter, so
 * this helper is gone: it used to generate a random candidate and retry on a
 * clash, which was the right shape while numbers were random and is the wrong
 * shape now. See `takeNextAccountNumber`.
 */

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

function metaFrom(request: FastifyRequest): RequestMeta {
  return {
    userAgent: request.headers["user-agent"],
    ipAddress: request.ip,
  };
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { prisma, throttle, cookieSecure, consentPolicy, registrationMode } = options;
  const inviteRequired = registrationMode === "invite";

  /**
   * Sign one device in, without touching any other device's session.
   *
   * ⚠️ **This used to be one session per user, and the owner removed that rule after a real test**:
   * "我觉得是时候删除掉每个账号只能有一台设备登录的限制了；每个账号现在都应该可以被多台设备同时登录，而不会被
   * 踢掉."
   *
   * What it did: `upsert({ where: { userId } })` overwrote whatever session existed, so **signing in on the
   * phone logged the tablet out at its next request.** And it was interfering with the feature being tested —
   * **the offline design is built on two devices holding two copies of one ledger**, and conflict detection only
   * exists because those copies can diverge. **A rule that logs one of them out removes the ability to use, and
   * to test, the thing it interrupts.**
   *
   * ⚠️ **Nothing about the security model needed it.** A session is identified by the hash of its own token,
   * which is unique on its own; revocation is per-token; and a password change still clears every session for
   * the account, **which is the one place where "all devices, all at once" is actually the intent.**
   *
   * ⚠️ **Old sessions are not cleaned up here.** They expire on their own after `SESSION_TTL_MS`, and deleting
   * them on sign-in would be deleting rows on a path that has nothing to do with them — **a device that is
   * logged out by somebody else's login is exactly the behaviour being removed.**
   */
  async function issueSession(reply: FastifyReply, userId: string, meta: RequestMeta): Promise<void> {
    const token = generateSessionToken();

    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: sessionExpiryFrom(new Date()),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    setSessionCookie(reply, token, cookieSecure);
  }

  const requireAuth = createRequireAuth(prisma);

  app.patch("/api/v1/auth/profile", { preHandler: requireAuth }, async (request) => {
    const body = updateProfileRequestSchema.parse(request.body);
    const id = request.currentUser!.id;

    /**
     * ⚠️ **特典头像必须真的解锁过。** 前端把锁定头像的保存按钮禁掉只是体验；
     * 这里是服务端边界 —— 直接改请求体也选不上未解锁的头像。
     */
    if (body.field === "avatarId") {
      await assertAvatarSelectable(prisma, { userId: id, avatarId: body.value });
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        const result = await tx.user.updateMany({
          where: { id, [body.field]: body.previousValue },
          data: { [body.field]: body.value },
        });
        if (result.count !== 1) {
          throw conflict("profile_changed", "这项资料已在其他设备修改，请刷新后再试。当前输入仍保留。");
        }
        return tx.user.findUniqueOrThrow({ where: { id } });
      });
      return meResponseSchema.parse({ user: toSessionUser(user) });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw conflict("username_taken", "该用户名已被占用，请换一个。");
      }
      throw error;
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/registration-config
  // ---------------------------------------------------------------------------
  /**
   * What the signup page needs to know before showing a form: **does creating an account need an
   * invite code right now?**
   *
   * ⚠️ **Deliberately only the mode.** No quota numbers, no counters, no server configuration —
   * the answer is the same for every anonymous visitor and reveals nothing that the registration
   * form would not reveal by existing.
   *
   * ⚠️ **Public, because the page that needs it is the one page a visitor can reach without an
   * account.** It sits in the auth module beside the register handler so the two cannot disagree:
   * the same `inviteRequired` decides both what this endpoint answers and what the handler enforces.
   */
  app.get("/api/v1/auth/registration-config", async () =>
    registrationConfigResponseSchema.parse({ mode: registrationMode, inviteRequired }),
  );

  async function assertNotThrottled(
    request: FastifyRequest,
    reply: FastifyReply,
    keys: readonly string[],
  ): Promise<void> {
    const retryAfter = throttle.retryAfterSeconds(keys);

    if (retryAfter > 0) {
      reply.header("retry-after", String(retryAfter));
      throw tooManyRequests("too_many_attempts", `尝试次数过多，请 ${String(retryAfter)} 秒后再试。`);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/register
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = registerRequestSchema.parse(request.body);
    const inviteCode = body.inviteCode?.toUpperCase() ?? "";

    /**
     * Registration must carry an affirmative acceptance of every currently required document.
     * The hashes were issued by the public legal-document endpoint and are re-verified here; the
     * client cannot accept a stale or invented version.
     */
    const requiredAgreements = requiredDocuments(consentPolicy);
    const suppliedAgreements = body.agreements ?? [];
    const missingAgreements = requiredAgreements.filter(
      (required) =>
        !suppliedAgreements.some(
          (supplied) =>
            supplied.documentId === required.id &&
            supplied.documentVersion === required.version &&
            supplied.contentHash === required.contentHash,
        ),
    );
    if (missingAgreements.length > 0) {
      throw badRequest(
        "agreement_required",
        "注册前需要先阅读并同意当前适用的协议。",
        { documentIds: missingAgreements.map((document) => document.id) },
      );
    }

    /**
     * ⚠️ **The registration mode decides whether a code is required, and this is the only place the
     * decision is enforced.** The public config endpoint tells the page what to show, but the page
     * is not the boundary: a body that omits the field while the mode is `invite` is refused here,
     * so hiding the input can never make registration easier than the rule.
     *
     * ⚠️ **In `open` mode a supplied code is deliberately ignored, not consumed.** An old client or
     * a hand-made request may still send one; redeeming it would burn a credential that the person
     * who owns it never expected to spend, and the account is not being created *because* of it.
     */
    if (inviteRequired && inviteCode === "") {
      throw badRequest("invite_required", "请填写邀请码。");
    }

    const invite = inviteRequired
      ? await prisma.registrationInvite.findUnique({ where: { code: inviteCode } })
      : null;

    if (inviteRequired && invite === null) throw badRequest("invite_invalid", "邀请码无效。");

    if (invite !== null) {
      /**
       * Why this code cannot be used, if it cannot.
       *
       * The rule lives in `shared` (`rejectInvite`) because the invite list has to
       * label a code the same way registration rejects it — a code that reads
       * "已过期" in one place and "可用" in another is a support ticket. `used` is
       * checked first there, so a code that was both used and has since expired
       * says "used", which is the fact that ends the story.
       */
      const rejection = rejectInvite(invite);
      if (rejection !== null) {
        throw badRequest(INVITE_REJECTION_CODE[rejection], INVITE_REJECTION_MESSAGE[rejection]);
      }
    }

    const taken = await prisma.user.findUnique({ where: { username: body.username } });
    if (taken) throw conflict("username_taken", "该用户名已被占用。");

    const passwordHash = await hashPassword(body.password);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await hashPassword(normalizeRecoveryCode(recoveryCode));

    const user = await prisma.$transaction(async (tx) => {
      /**
       * The number comes from the invite when the invite reserved one, and from
       * the counter otherwise.
       *
       * A reserved number is *not* re-checked against `users`: the migration put
       * a unique index on `registration_invites.account_number`, so the same
       * number cannot sit on two codes, and the block those codes draw from was
       * placed below the counter's starting point. The unique index on
       * `users.account_number` still fails the insert if that reasoning is ever
       * wrong, which is the point of having it.
       */
      const accountNumber = invite?.accountNumber ?? (await takeNextAccountNumber(tx));

      const created = await tx.user.create({
        data: {
          accountNumber,
          username: body.username,
          displayName: body.displayName,
          passwordHash,
          recoveryCodeHash,
          /**
           * ⚠️ **`false`, always — registration cannot create an administrator** (2026-10-14,
           * 1.10.22).
           *
           * This used to be `invite.grantsAdmin`, and before that
           * `invite.accountNumber !== null`. Both were the same mistake at different
           * removes: **a piece of paper decided a privilege.**
           *
           * The batch of 98 codes the owner had printed (`10000002`–`10000099`) carried
           * `grants_admin = true`, never expired, and were meant to be handed out over
           * months. Redeeming one silently produced an administrator — **without anybody
           * deciding so at the moment it happened, which is the only moment a privilege
           * should need.** An invitation says "you may have an account"; it says nothing
           * about who may administer the platform, and a code in somebody's drawer cannot
           * be asked.
           *
           * Administration is now an explicit act: an `AdminGrant` row written by
           * `tools/grant-admin.mjs`, which the admin guard requires. The reserved numbers
           * those codes hand out are unaffected — they were never the privilege.
           */
          isAdmin: false,
        },
      });

      // The account is useless without a ledger, so it is created here, inside
      // the same transaction: book, membership, preset categories and payment
      // methods all exist, or the signup does not happen at all.
      //
      // The name follows the language the person registered in — see
      // `defaultBookNameFor` for why the server, not the screen, has to decide.
      await createDefaultLedger(tx, created.id, defaultBookNameFor(request.headers["accept-language"]));

      /**
       * The acceptance evidence is written in the same transaction as the account. A failed
       * signup must not leave either half behind.
       */
      if (requiredAgreements.length > 0) {
        await tx.agreementAcceptance.createMany({
          data: requiredAgreements.map((document) => ({
            userId: created.id,
            documentId: document.id,
            documentVersion: document.version,
            contentHash: document.contentHash,
            action: "accept",
          })),
        });
      }

      /**
       * The invite is claimed only when there is one. In `open` mode there is nothing to claim,
       * and writing an "invite used" event for a code nobody presented would make the audit trail
       * say something that did not happen.
       */
      if (invite !== null) {
        /**
         * Claim the invite inside the same transaction: `usedAt: null` in the
         * filter means two simultaneous registrations cannot both consume it.
         *
         * `revokedAt: null` is checked again here, not only above, because a code
         * revoked between that check and this line must not register anybody. The
         * window is small and the guard is one extra condition.
         */
        const claimed = await tx.registrationInvite.updateMany({
          where: { id: invite.id, usedAt: null, revokedAt: null },
          data: { usedByUserId: created.id, usedAt: new Date() },
        });

        if (claimed.count !== 1) {
          throw badRequest("invite_used", "该邀请码已被使用。");
        }

        /**
         * ⚠️ **A referral code leaves two traces, and both are written here, in the same transaction.**
         *
         * `referredByUserId` on the new account is *who invited me*; the reminder is what the newcomer
         * actually sees for seven days.
         *
         * ⚠️ **Inside the transaction, because a half-recorded referral cannot be repaired**: an
         * account created without its `referredByUserId`, or with one but no invitation marked used,
         * is a state where "who invited whom" has two different answers depending on which table you
         * ask. **`教训.md` §8.7 is about exactly that.**
         *
         * ⚠️ **A plain invitation leaves neither** — `createdByUserId` is what distinguishes a referral
         * code from a batch-minted ticket, and this is where that distinction pays off.
         */
        if (invite.createdByUserId !== null) {
          const generator = await tx.user.findUnique({
            where: { id: invite.createdByUserId },
            select: { displayName: true },
          });

          if (generator) {
            await recordReferral(tx, {
              newUserId: created.id,
              generatorId: invite.createdByUserId,
              generatorDisplayName: generator.displayName,
            });
          }
        }
      }

      await recordCriticalEvent(tx, {
        type: "account.created",
        actor: { userId: created.id, accountNumber: created.accountNumber },
        subjectType: "account",
        subjectId: created.id,
        afterState: {
          accountNumber: created.accountNumber,
          username: created.username,
          isAdmin: false,
        },
        occurredAt: created.createdAt,
      });
      if (requiredAgreements.length > 0) {
        await recordCriticalEvent(tx, {
          type: "agreement.accepted",
          actor: { userId: created.id, accountNumber: created.accountNumber },
          subjectType: "agreement",
          subjectId: created.id,
          afterState: {
            documents: requiredAgreements.map((document) => ({
              documentId: document.id,
              documentVersion: document.version,
              contentHash: document.contentHash,
            })),
            action: "accept",
            source: "registration",
          },
        });
      }
      if (invite !== null) {
        await recordCriticalEvent(tx, {
          type: "invite.used",
          actor: { userId: created.id, accountNumber: created.accountNumber },
          subjectType: "invite",
          subjectId: invite.id,
          afterState: {
            inviteId: invite.id,
            usedByUserId: created.id,
            usedAtIso: new Date().toISOString(),
          },
        });
      }

      return created;
    });

    await issueSession(reply, user.id, metaFrom(request));
    reply.status(201);

    return authResponseSchema.parse({ user: toSessionUser(user), recoveryCode });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);
    const keys = [`user:${body.username.toLowerCase()}`, `ip:${request.ip}`];

    await assertNotThrottled(request, reply, keys);

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    let passwordOk = false;

    if (user) {
      passwordOk = await verifyPassword(user.passwordHash, body.password);
    } else {
      // Equalise timing so an unknown username is not measurably faster.
      await verifyPassword(await getDummyHash(), body.password);
    }

    if (!user || !passwordOk) {
      throttle.recordFailure(keys);
      throw unauthorized("invalid_credentials", "用户名或密码不正确。");
    }

    /**
     * **A suspended account cannot sign in** (S13).
     *
     * ⚠️ **The message is the one the owner specified** — *"该账户目前已停用或不存在"* — and it
     * is written to be indistinguishable from "no such account", which is what keeps the login
     * form from answering *"does this username exist, and was it banned?"*. The password is
     * verified **before** this check so a suspended account costs the same time as a real one.
     *
     * ⚠️ It counts as a failed attempt, so a suspended person guessing passwords is throttled
     * exactly like anybody else.
     */
    if (user.closedAt !== null) {
      throttle.recordFailure(keys);
      throw unauthorized("account_closed", "这个账号已经注销。");
    }

    if (user.disabledAt !== null) {
      throttle.recordFailure(keys);
      throw unauthorized("account_disabled", "该账户目前已停用或不存在。");
    }

    throttle.recordSuccess(keys);
    await issueSession(reply, user.id, metaFrom(request));

    return authResponseSchema.parse({ user: toSessionUser(user) });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/logout
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];

    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    }

    clearSessionCookie(reply);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/me
  // ---------------------------------------------------------------------------
  app.get("/api/v1/auth/me", { preHandler: requireAuth }, async (request) => {
    const user = request.currentUser!;

    /**
     * ⚠️ **奖励判定挂在 `/auth/me` 上，而不是单独跑一个定时任务。** App 每 60 秒、每次
     * 回到前台、每次登录后都会调这个接口，所以“新用户首次登录”“老用户首次在线”
     * “纪念日当天已经登录着”，都只需要一次普通的读请求就能补发——不需要签到按钮，
     * 也不要求用户先打开头像页。
     *
     * ⚠️ **判定失败绝不能挡住这个接口。** 头像奖励坏了，登录、同步、记账都不该跟着坏；
     * 这轮没拿到，下一轮 /auth/me 会重试，库里没有重复记录所以重试是幂等的。
     */
    let pendingRewardEvents: unknown[] | undefined;
    try {
      const check = await runAvatarRewardCheck(prisma, {
        userId: user.id,
        headerZone: readTimeZoneHeader(request.headers),
        now: new Date(),
      });
      pendingRewardEvents = check.events.length > 0 ? [...check.events] : undefined;
    } catch {
      pendingRewardEvents = undefined;
    }

    return meResponseSchema.parse(
      pendingRewardEvents === undefined
        ? { user }
        : { user, avatarRewardEvents: pendingRewardEvents },
    );
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/auth/me
  // ---------------------------------------------------------------------------

  /**
   * Account-level preferences.
   *
   * Only the default currency for now. It lives on the user rather than the
   * book because it describes how the owner thinks about money, not how a
   * particular ledger is kept.
   */
  app.patch("/api/v1/auth/me", { preHandler: requireAuth }, async (request) => {
    const body = updatePreferencesRequestSchema.parse(request.body);
    const userId = request.currentUser!.id;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { defaultCurrency: body.defaultCurrency },
    });

    return meResponseSchema.parse({
      user: toSessionUser(updated),
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/password
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/password", { preHandler: requireAuth }, async (request, reply) => {
    const body = changePasswordRequestSchema.parse(request.body);
    const current = request.currentUser!;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });

    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw unauthorized("invalid_password", "当前密码不正确");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      });
      // A password change is a credential invalidation: old devices must not survive it.
      await tx.session.deleteMany({ where: { userId: user.id } });
      await recordCriticalEvent(tx, {
        type: "auth.password_changed",
        actor: { userId: user.id, accountNumber: user.accountNumber },
        subjectType: "account",
        subjectId: user.id,
        beforeState: { credential: "password" },
        afterState: { credential: "password_changed", sessionsRevoked: true },
        requestId: request.id,
      });
    });

    // Rotate the session token after the old credentials/sessions have been invalidated.
    await issueSession(reply, user.id, metaFrom(request));
    await confirmP0(prisma);

    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/recover — reset a forgotten password with the recovery code
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/recover", async (request, reply) => {
    const body = recoverRequestSchema.parse(request.body);
    const keys = [`recover:${body.username.toLowerCase()}`, `ip:${request.ip}`];

    await assertNotThrottled(request, reply, keys);

    const user = await prisma.user.findUnique({ where: { username: body.username } });
    const usable = Boolean(user?.recoveryCodeHash) && !user?.recoveryCodeUsedAt;

    let codeOk = false;
    if (user?.recoveryCodeHash && usable) {
      codeOk = await verifyPassword(user.recoveryCodeHash, normalizeRecoveryCode(body.recoveryCode));
    } else {
      await verifyPassword(await getDummyHash(), body.recoveryCode);
    }

    if (!user || !codeOk) {
      throttle.recordFailure(keys);
      throw unauthorized("invalid_recovery_code", "用户名或恢复码不正确");
    }

    throttle.recordSuccess(keys);

    // A recovery code is single use; hand out a fresh one so the account is
    // never left without a way back in.
    const newRecoveryCode = generateRecoveryCode();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          recoveryCodeHash: await hashPassword(normalizeRecoveryCode(newRecoveryCode)),
          recoveryCodeUsedAt: null,
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await recordCriticalEvent(tx, {
        type: "auth.password_reset",
        actor: { userId: user.id, accountNumber: user.accountNumber },
        subjectType: "account",
        subjectId: user.id,
        beforeState: { credential: "password+recovery_code" },
        afterState: { credential: "password_reset", sessionsRevoked: true },
        requestId: request.id,
      });
    });
    clearSessionCookie(reply);
    await confirmP0(prisma);

    return recoveryCodeResponseSchema.parse({ recoveryCode: newRecoveryCode });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/recovery-code — issue a new recovery code while signed in
  // ---------------------------------------------------------------------------
  app.post("/api/v1/auth/recovery-code", { preHandler: requireAuth }, async (request) => {
    const body = regenerateRecoveryCodeRequestSchema.parse(request.body);
    const current = request.currentUser!;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw unauthorized("invalid_password", "密码不正确");
    }

    const recoveryCode = generateRecoveryCode();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          recoveryCodeHash: await hashPassword(normalizeRecoveryCode(recoveryCode)),
          recoveryCodeUsedAt: null,
        },
      });
      await recordCriticalEvent(tx, {
        type: "auth.recovery_code_rotated",
        actor: { userId: user.id, accountNumber: user.accountNumber },
        subjectType: "account",
        subjectId: user.id,
        beforeState: { recoveryCodeRotated: false },
        afterState: { recoveryCodeRotated: true, oldRecoveryCodeInvalidated: true },
        requestId: request.id,
      });
    });
    await confirmP0(prisma);

    return recoveryCodeResponseSchema.parse({ recoveryCode });
  });
}
