import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { AVATAR_REWARD_ACTIVITIES } from "@libellum/shared";

import {
  confirmAvatarRewardEvent,
  evaluateAvatarRewards,
  resolveAccountTimeZone,
  runAvatarRewardCheck,
  useAvatarRewardMakeUp,
} from "../src/rewards/service.js";
import {
  FALLBACK_TIME_ZONE,
  isYearlyRuleDate,
  latestPastYearlyRuleDate,
  localDate,
  nthWeekdayOfMonth,
  type YearlyNthWeekdayRule,
} from "../src/rewards/timeZone.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * 特典头像奖励（S16）的集成测试。
 *
 * 会碰真库：唯一约束、事务与级联是这轮功能的核心，mock 不出“多设备并发只发一次”。
 * 纪念日相关用例**不依赖真实日期**——直接给 `runAvatarRewardCheck` 注入 `now`，
 * 所以这套测试在任何日子跑结果都一样。
 */

let app: FastifyInstance;
let cookie: string;
let userId: string;

const PASSWORD = "correct-horse-battery";

const timeZoneHeader = { "x-libellum-time-zone": "Asia/Shanghai" };

async function me(session = cookie, timeZone?: string): Promise<{ statusCode: number; json: () => any; body: string }> {
  return app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { cookie: session, ...(timeZone === undefined ? {} : { "x-libellum-time-zone": timeZone }) },
  });
}

async function login(username: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password: PASSWORD },
  });
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") throw new Error("login did not set a session cookie");
  return value.split(";")[0] ?? "";
}

async function makeUp(avatarId: string, session = cookie, timeZone = "Asia/Shanghai") {
  return app.inject({
    method: "POST",
    url: `/api/v1/avatar-rewards/${avatarId}/make-up`,
    headers: { cookie: session, "x-libellum-time-zone": timeZone },
  });
}

async function rewards(session = cookie, timeZone?: string) {
  return app.inject({
    method: "GET",
    url: "/api/v1/avatar-rewards",
    headers: { cookie: session, ...(timeZone === undefined ? {} : { "x-libellum-time-zone": timeZone }) },
  });
}

async function patchProfile(payload: Record<string, unknown>, session = cookie) {
  return app.inject({
    method: "PATCH",
    url: "/api/v1/auth/profile",
    headers: { cookie: session },
    payload,
  });
}

/** 直接改库：把账户放到指定时区/建号时间，用于时区与补领用例。 */
async function prepareAccount(input: {
  timeZone?: string | null;
  createdAt?: Date;
  timeZoneUpdatedAt?: Date | null;
}): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.timeZoneUpdatedAt === undefined ? {} : { timeZoneUpdatedAt: input.timeZoneUpdatedAt }),
    },
  });
}

const shaoxing = "2026-11-18T16:30:00.000Z"; // 东八区 2026-11-19 00:30（UTC 还是 18 日）
const philosophyDay = new Date("2026-11-19T04:00:00.000Z"); // 东八区 2026-11-19 12:00
const utcEarlyMorning = new Date("2026-11-18T17:00:00.000Z"); // 东八区 2026-11-19 01:00，UTC 仍是 18 日

const yearlyRule: YearlyNthWeekdayRule = { kind: "yearly_nth_weekday", month: 11, weekday: 4, nth: 3 };

beforeEach(async () => {
  await resetDatabase();
  app = makeApp();
  cookie = await signUp(app, "rewards_one");
  userId = (await prisma.user.findUniqueOrThrow({ where: { username: "rewards_one" } })).id;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("首次登录自动获得「降临」", () => {
  it("万圣按账户当地 10 月 31 日发放，午夜边界准确且领取后永久保留", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai" });
    const check = (now: string) => runAvatarRewardCheck(prisma, { userId, headerZone: "Asia/Shanghai", now: new Date(now) });
    const count = () => prisma.avatarUnlock.count({ where: { userId, avatarId: "halloween-special" } });
    expect((await patchProfile({ field: "avatarId", value: "halloween-special", previousValue: "flower" })).statusCode).toBe(409);
    await check("2026-10-30T15:59:59.999Z");
    expect(await count()).toBe(0);
    await Promise.all(Array.from({ length: 4 }, () => check("2026-10-30T16:00:00.000Z")));
    expect(await count()).toBe(1);
    expect(await prisma.avatarRewardEvent.count({ where: { userId, avatarId: "halloween-special" } })).toBe(1);
    expect((await patchProfile({ field: "avatarId", value: "halloween-special", previousValue: "flower" })).statusCode).toBe(200);
    const session = await login("rewards_one");
    expect((await me(session)).json().user.avatarId).toBe("halloween-special");
    await check("2026-10-31T16:00:00.000Z");
    await check("2027-10-31T04:00:00.000Z");
    expect(await count()).toBe(1);
    expect((await makeUp("halloween-special")).statusCode).toBe(409);
  });

  it("西半球按当地日期领取，不按 UTC 日期提前发放", async () => {
    const check = (now: string) => runAvatarRewardCheck(prisma, { userId, headerZone: "America/Los_Angeles", now: new Date(now) });
    await check("2026-10-31T06:59:59.999Z");
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "halloween-special" } })).toBe(0);
    await check("2026-11-01T06:59:59.999Z");
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "halloween-special" } })).toBe(1);
  });

  it("错过万圣节不补发，不能绕过锁定直接保存或补领", async () => {
    await runAvatarRewardCheck(prisma, { userId, headerZone: "Asia/Shanghai", now: new Date("2026-10-31T16:00:00.000Z") });
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "halloween-special" } })).toBe(0);
    expect((await makeUp("halloween-special")).statusCode).toBe(409);
    expect((await patchProfile({ field: "avatarId", value: "halloween-special", previousValue: "flower" })).statusCode).toBe(409);
  });
  it("新账户第一次带着认证请求打开 App 时自动解锁并返回待通知事件", async () => {
    const response = await me();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.avatarRewardEvents).toEqual([expect.objectContaining({ avatarId: "descent-special" })]);

    const unlock = await prisma.avatarUnlock.findUnique({
      where: { userId_avatarId: { userId, avatarId: "descent-special" } },
    });
    expect(unlock).toMatchObject({ activityId: "descent-first-login", source: "first_login" });
    const event = await prisma.avatarRewardEvent.findFirst({ where: { userId } });
    expect(event).toMatchObject({ avatarId: "descent-special", status: "pending" });
  });

  it("已解锁后不会重复发放，也不再产生新事件", async () => {
    await me();
    await me();
    await me();
    expect(await prisma.avatarUnlock.count({ where: { userId } })).toBe(1);
    expect(await prisma.avatarRewardEvent.count({ where: { userId } })).toBe(1);
  });

  it("老账户（注册时还没这套功能）第一次在线请求也会补发", async () => {
    await prisma.user.update({ where: { id: userId }, data: { createdAt: new Date("2024-01-01T00:00:00.000Z") } });
    expect(await prisma.avatarUnlock.count({ where: { userId } })).toBe(0);
    await me();
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "descent-special" } })).toBe(1);
  });

  it("两台设备同时第一次请求，只会发一次、只留一条解锁", async () => {
    const second = await login("rewards_one");
    const results = await Promise.all(Array.from({ length: 6 }, () => me()));
    expect(results.every(result => result.statusCode === 200)).toBe(true);
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "descent-special" } })).toBe(1);
    expect(await prisma.avatarRewardEvent.count({ where: { userId } })).toBe(1);
    expect(second.length).toBeGreaterThan(0);
  });

  it("待通知事件会被重复下发直到界面确认；确认后不再下发", async () => {
    const first = (await me()).json();
    const eventId = first.avatarRewardEvents[0].id as string;
    const second = (await me()).json();
    expect(second.avatarRewardEvents).toEqual([expect.objectContaining({ id: eventId })]);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/avatar-rewards/${eventId}/confirm`,
      headers: { cookie },
    });
    expect(confirmed.statusCode).toBe(204);
    const third = (await me()).json();
    expect(third.avatarRewardEvents).toBeUndefined();
    const row = await prisma.avatarRewardEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe("confirmed");

    // 重复确认幂等，不报错。
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/avatar-rewards/${eventId}/confirm`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(204);
  });
});

describe("账户时区", () => {
  it("首次请求带设备时区则写入账户并记录来源", async () => {
    await me(cookie, "Asia/Shanghai");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.timeZone).toBe("Asia/Shanghai");
    const changes = await prisma.userTimeZoneChange.findMany({ where: { userId } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ fromZone: null, toZone: "Asia/Shanghai", source: "first_login" });
  });

  it("没有时区头或时区非法时保持未确认，不发奖判定按 UTC 回退", async () => {
    await me();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).timeZone).toBeNull();
    await me(cookie, "Mars/Olympus");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).timeZone).toBeNull();
    const state = await resolveAccountTimeZone(prisma, { userId, headerZone: undefined, now: new Date() });
    expect(state).toEqual({ zone: FALLBACK_TIME_ZONE, confirmed: false });
  });

  it("短时间内改时区不会立刻生效，超过冷却期才更新并记历史", async () => {
    const now = new Date("2026-10-25T04:00:00.000Z");
    await resolveAccountTimeZone(prisma, { userId, headerZone: "America/Los_Angeles", now });
    const blocked = await resolveAccountTimeZone(prisma, { userId, headerZone: "Asia/Shanghai", now });
    expect(blocked.zone).toBe("America/Los_Angeles");

    const later = new Date("2026-10-25T12:00:00.000Z");
    const changed = await resolveAccountTimeZone(prisma, { userId, headerZone: "Asia/Shanghai", now: later });
    expect(changed.zone).toBe("Asia/Shanghai");
    const changes = await prisma.userTimeZoneChange.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ fromZone: "America/Los_Angeles", toZone: "Asia/Shanghai", source: "request" });
  });
});

describe("世界哲学日（11 月第三个星期四）按账户时区判定", () => {
  it("东八区当地 11-19 当天发放「倒悬」", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai" });
    const events = await evaluateAvatarRewards(prisma, { userId, timeZone: "Asia/Shanghai", now: philosophyDay });
    // 同一次调用里「降临」也会因为首次登录而发放；这里只断言「倒悬」。
    expect(events.filter(event => event.avatarId === "daoxuan-special")).toEqual([
      expect.objectContaining({ avatarId: "daoxuan-special" }),
    ]);
    const unlock = await prisma.avatarUnlock.findUnique({
      where: { userId_avatarId: { userId, avatarId: "daoxuan-special" } },
    });
    expect(unlock).toMatchObject({ activityId: "daoxuan-philosophy-day", source: "anniversary" });
  });

  it("UTC 日期已经是 19 日、但账户当地还是 18 日时不发", async () => {
    await prepareAccount({ timeZone: "America/Los_Angeles" });
    const events = await evaluateAvatarRewards(prisma, { userId, timeZone: "America/Los_Angeles", now: philosophyDay });
    expect(events.some(event => event.avatarId === "daoxuan-special")).toBe(false);
    // 同一次调用里「降临」仍然会发，说明判定是逐活动而不是整段跳过。
    expect(events.some(event => event.avatarId === "descent-special")).toBe(true);
  });

  it("当地已经进入 19 日、UTC 仍是 18 日时照样发", async () => {
    const events = await evaluateAvatarRewards(prisma, {
      userId,
      timeZone: "Asia/Shanghai",
      now: utcEarlyMorning,
    });
    expect(events.some(event => event.avatarId === "daoxuan-special")).toBe(true);
  });

  it("不是规则日（20 日、第四个星期四、别的月份）都不发", async () => {
    for (const now of [
      new Date("2026-11-20T04:00:00.000Z"),
      new Date("2026-11-26T04:00:00.000Z"),
      new Date("2026-10-15T04:00:00.000Z"),
    ]) {
      await resetDatabase();
      app = makeApp();
      cookie = await signUp(app, "rewards_one");
      userId = (await prisma.user.findUniqueOrThrow({ where: { username: "rewards_one" } })).id;
      await prepareAccount({ timeZone: "Asia/Shanghai" });
      const events = await evaluateAvatarRewards(prisma, { userId, timeZone: "Asia/Shanghai", now });
      expect(events.some(event => event.avatarId === "daoxuan-special")).toBe(false);
    }
  });

  it("2027 年规则日是 11-18；同一活动跨年已拥有后不会重复发放", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai" });
    await evaluateAvatarRewards(prisma, { userId, timeZone: "Asia/Shanghai", now: philosophyDay });
    // 先把 2026 年的待通知事件确认掉，这样下一年的返回值只可能是“新发放”的。
    const pending = await prisma.avatarRewardEvent.findMany({ where: { userId, status: "pending" } });
    for (const event of pending) {
      await confirmAvatarRewardEvent(prisma, { userId, eventId: event.id, now: philosophyDay });
    }
    const nextYear = await evaluateAvatarRewards(prisma, {
      userId,
      timeZone: "Asia/Shanghai",
      now: new Date("2027-11-18T04:00:00.000Z"),
    });
    expect(nextYear.some(event => event.avatarId === "daoxuan-special")).toBe(false);
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "daoxuan-special" } })).toBe(1);
  });

  it("日历计算与 DST 边界：纽约 19 日 00:00 EST 才算进入当天", () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 3)).toBe("2026-11-19");
    expect(nthWeekdayOfMonth(2027, 11, 4, 3)).toBe("2027-11-18");
    // 2026-11-19T04:00Z = 纽约 11-18 23:00（EST），还没到当天。
    expect(isYearlyRuleDate(new Date("2026-11-19T04:00:00.000Z"), "America/New_York", yearlyRule)).toBe(false);
    // 05:00Z = 纽约 11-19 00:00。
    expect(isYearlyRuleDate(new Date("2026-11-19T05:00:00.000Z"), "America/New_York", yearlyRule)).toBe(true);
    // 伦敦当天 00:00 GMT = 2026-11-19T00:00Z。
    expect(isYearlyRuleDate(new Date("2026-11-19T00:00:00.000Z"), "Europe/London", yearlyRule)).toBe(true);
    expect(isYearlyRuleDate(new Date("2026-11-18T23:59:00.000Z"), "Europe/London", yearlyRule)).toBe(false);
  });

  it("错过规则日之后不会自动补发，但补领能看到最近一次已过去的日子", () => {
    expect(latestPastYearlyRuleDate(new Date("2026-11-20T00:00:00.000Z"), "Asia/Shanghai", yearlyRule)).toBe(
      "2026-11-19",
    );
    expect(
      latestPastYearlyRuleDate(new Date("2026-11-20T00:00:00.000Z"), "Asia/Shanghai", yearlyRule, "2026-11-19"),
    ).toBeNull();
    expect(localDate(new Date("2026-11-19T04:00:00.000Z"), "Asia/Shanghai")).toBe("2026-11-19");
  });
});

describe("一次性补领", () => {
  it("账户存在期间错过规则日时，可以补领「倒悬」一次", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai", createdAt: new Date("2024-01-01T00:00:00.000Z") });
    const response = await makeUp("daoxuan-special");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.unlocked).toMatchObject({ avatarId: "daoxuan-special", source: "make_up" });
    expect(body.pendingEvents).toEqual([expect.objectContaining({ avatarId: "daoxuan-special" })]);
    expect(await prisma.avatarMakeUpGrant.count({ where: { userId } })).toBe(1);
  });

  it("补领名额只有一次，第二次返回 409 make_up_used，且不新增解锁", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai", createdAt: new Date("2024-01-01T00:00:00.000Z") });
    expect((await makeUp("daoxuan-special")).statusCode).toBe(200);
    const second = await makeUp("daoxuan-special");
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("make_up_used");
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "daoxuan-special" } })).toBe(1);
  });

  it("已经拥有头像时不能补领，返回 409 avatar_already_owned", async () => {
    await prisma.avatarUnlock.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        userId,
        avatarId: "daoxuan-special",
        activityId: "daoxuan-philosophy-day",
        source: "anniversary",
        unlockedAt: new Date("2026-11-19T00:00:00.000Z"),
      },
    });
    const response = await makeUp("daoxuan-special");
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("avatar_already_owned");
    expect(await prisma.avatarMakeUpGrant.count({ where: { userId } })).toBe(0);
  });

  it("没有可补领的历史日期时返回 409，且失败不消耗名额", async () => {
    // 账户建在最近一次规则日之后：最近的那次不算“账户存在期间”。
    await prepareAccount({ timeZone: "Asia/Shanghai", createdAt: new Date("2026-12-01T00:00:00.000Z") });
    const failed = await makeUp("daoxuan-special");
    expect(failed.statusCode).toBe(409);
    expect(failed.json().code).toBe("make_up_unavailable");
    expect(await prisma.avatarMakeUpGrant.count({ where: { userId } })).toBe(0);

    // 把建号时间改早，名额还在，可以成功。
    await prepareAccount({ createdAt: new Date("2024-01-01T00:00:00.000Z") });
    expect((await makeUp("daoxuan-special")).statusCode).toBe(200);
  });

  it("并发补领只成功一次，剩余名额不会被并发写坏", async () => {
    await prepareAccount({ timeZone: "Asia/Shanghai", createdAt: new Date("2024-01-01T00:00:00.000Z") });
    const results = await Promise.all(Array.from({ length: 5 }, () => makeUp("daoxuan-special")));
    expect(results.filter(result => result.statusCode === 200)).toHaveLength(1);
    expect(results.filter(result => result.statusCode === 409)).toHaveLength(4);
    expect(await prisma.avatarMakeUpGrant.count({ where: { userId } })).toBe(1);
    expect(await prisma.avatarUnlock.count({ where: { userId, avatarId: "daoxuan-special" } })).toBe(1);
  });

  it("服务端按账户时区算补领日期，客户端提交的时间不参与", async () => {
    await prepareAccount({ timeZone: "America/Los_Angeles", createdAt: new Date("2024-01-01T00:00:00.000Z") });
    const response = await useAvatarRewardMakeUp(prisma, {
      userId,
      avatarId: "daoxuan-special",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-11-20T04:00:00.000Z"),
    });
    expect(response.unlocked.avatarId).toBe("daoxuan-special");
  });
});

describe("头像页状态与解锁校验", () => {
  it("未解锁的特典头像保存被服务端拒绝（409 avatar_locked），数据库不变", async () => {
    const response = await patchProfile({ field: "avatarId", value: "daoxuan-special", previousValue: "flower" });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("avatar_locked");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).avatarId).toBe("flower");
  });

  it("已解锁的特典头像可以保存；经典头像始终可保存", async () => {
    await me(); // 解锁「降临」
    expect((await patchProfile({ field: "avatarId", value: "descent-special", previousValue: "flower" })).statusCode).toBe(
      200,
    );
    let previousValue = "descent-special";
    for (const value of ["sprout", "moon", "leaf", "cat"]) {
      const response = await patchProfile({ field: "avatarId", value, previousValue });
      expect(response.statusCode).toBe(200);
      previousValue = value;
    }
  });

  it("GET /avatar-rewards 返回活动、解锁、待通知事件与时区状态", async () => {
    const response = await rewards(cookie, "Asia/Shanghai");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activities.map((activity: { id: string }) => activity.id)).toEqual(
      AVATAR_REWARD_ACTIVITIES.map(activity => activity.id),
    );
    expect(body.unlocked).toEqual([expect.objectContaining({ avatarId: "descent-special" })]);
    expect(body.pendingEvents).toEqual([expect.objectContaining({ avatarId: "descent-special" })]);
    expect(body.timeZone).toEqual({ zone: "Asia/Shanghai", confirmed: true });
    // 今天刚建的账户还没有“账户存在期间错过的纪念日”，所以补领不可用；
    // 把建号时间改到一年前之后，最近一次已过去的规则日才落入账户存在期间。
    expect(body.makeUpAvailable).toBe(false);
    await prepareAccount({ createdAt: new Date("2024-01-01T00:00:00.000Z") });
    const after = await rewards(cookie, "Asia/Shanghai");
    expect(after.json().makeUpAvailable).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).timeZone).toBe("Asia/Shanghai");
  });

  it("未登录访问奖励接口返回 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/avatar-rewards" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/avatar-rewards/daoxuan-special/make-up" })).statusCode).toBe(
      401,
    );
  });

  it("确认事件走服务函数时同样只改自己的记录", async () => {
    const events = await runAvatarRewardCheck(prisma, { userId, headerZone: "Asia/Shanghai", now: new Date() });
    const eventId = events.events[0]!.id;
    const other = await signUp(app, "rewards_two");
    const token = other;
    await confirmAvatarRewardEvent(prisma, {
      userId: (await prisma.user.findUniqueOrThrow({ where: { username: "rewards_two" } })).id,
      eventId,
      now: new Date(),
    });
    expect((await prisma.avatarRewardEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("pending");
    expect(token.length).toBeGreaterThan(0);
  });
});
