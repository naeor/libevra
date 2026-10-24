import { AVATAR_IDS, APPROVED_AVATAR_IDS } from "@libellum/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar, AVATAR_LABELS } from "./UserAvatar.js";

describe("系统头像素材", () => {
  it("新旧 21 个稳定身份均可访问，不引入外部图像请求", () => {
    expect(AVATAR_IDS).toHaveLength(21);
    for (const id of AVATAR_IDS) {
      const html = renderToStaticMarkup(<UserAvatar avatarId={id} />);
      expect(html).toContain(`data-avatar-id="${id}"`);
      expect(html).toContain(`${AVATAR_LABELS[id]}头像`);
      expect(html).not.toContain("<image");
    }
  });
  it("六款素材与最终审核原型逐字一致，界面只消费主题变量", () => {
    const files = ["01-sprout.svg", "02-sun.svg", "03-crescent.svg", "04-morning-star.svg", "05-wave.svg", "06-coffee.svg"];
    for (const file of files) {
      const asset = readFileSync(resolve(import.meta.dirname, "../assets/avatars", file), "utf8");
      const approved = readFileSync(resolve(import.meta.dirname, "../../../../design/avatar-prototypes/round-01/svg", file), "utf8");
      expect(asset).toBe(approved);
      expect(asset).not.toMatch(/<script|<foreignObject|<image|\bon\w+=|href=/i);
    }
    for (const id of APPROVED_AVATAR_IDS) {
      const html = renderToStaticMarkup(<UserAvatar avatarId={id} />);
      expect(html).toContain('color:var(--color-brand)');
      expect(html).toContain('fill="var(--color-brand-soft)"');
      expect(html).toContain(`data-approved-art="${id}"`);
    }
  });
  it("多处弦月共享同一几何但使用独立蒙版，不覆盖其他实例", () => {
    const html = renderToStaticMarkup(<><UserAvatar avatarId="moon" /><UserAvatar avatarId="moon" /></>);
    const maskIds = [...html.matchAll(/<mask id="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(maskIds).size).toBe(2);
    for (const id of maskIds) expect(html).toContain(`url(#${id})`);
    expect(html).toContain('cx="46.5" cy="48" r="16.5"');
    expect(html).toContain('r="25" fill="black"');
  });
  it("旧账户和未知身份回退为小花", () => {
    expect(renderToStaticMarkup(<UserAvatar />)).toContain('data-avatar-id="flower"');
    expect(renderToStaticMarkup(<UserAvatar avatarId="removed" />)).toContain('data-avatar-id="flower"');
  });
  it("特典倒悬采用审核圆轨，白图深底且多实例蒙版独立", () => {
    const html = renderToStaticMarkup(<><UserAvatar avatarId="daoxuan-special" /><UserAvatar avatarId="daoxuan-special" /></>);
    expect(html).toContain('color:white');
    expect(html).toContain('cx="48" cy="48" r="27.5"');
    expect(html).toContain('cx="48" cy="48" r="22"');
    expect(html).toContain('var(--color-brand-dark');
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map(m => m[1]);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });
});
