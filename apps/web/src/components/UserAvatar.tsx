import { avatarIdSchema, type AvatarId } from "@libellum/shared";
import { useId } from "react";
import sprout from "../assets/avatars/01-sprout.svg?raw";
import sun from "../assets/avatars/02-sun.svg?raw";
import moon from "../assets/avatars/03-crescent.svg?raw";
import star from "../assets/avatars/04-morning-star.svg?raw";
import wave from "../assets/avatars/05-wave.svg?raw";
import coffee from "../assets/avatars/06-coffee.svg?raw";
import daoxuanSpecial from "../assets/avatars/07-daoxuan-special.svg?raw";
import { LegacyUserAvatar, type LegacyAvatarId } from "./LegacyUserAvatar.js";
import { t } from "../i18n/index.js";

export function avatarLabel(id: AvatarId): string { return t(`account.avatars.names.${id}`); }

// 只有打包时导入的、已审核的本地 SVG 可成为 HTML；账户输入只能查白名单 ID。
const APPROVED_SVG = { sprout, sun, moon, star, wave, coffee, "daoxuan-special": daoxuanSpecial } as const;
const ART = Object.fromEntries(Object.entries(APPROVED_SVG).map(([id, source]) => [
  id, source.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title\b[^>]*>[\s\S]*?<\/title>/, ""),
])) as Record<keyof typeof APPROVED_SVG, string>;

export function UserAvatar({ avatarId, className = "size-24" }: {
  readonly avatarId?: string | undefined;
  readonly className?: string;
}): React.JSX.Element {
  const instance = `avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = avatarIdSchema.catch("flower").parse(avatarId);
  if (id !== "flower" && !(id in ART)) {
    return <LegacyUserAvatar avatarId={id as LegacyAvatarId} label={avatarLabel(id)} className={className} />;
  }
  // 每个实例独立命名蒙版，顶部预览与网格中的弦月不会相互引用或覆盖。
  const body = id === "flower" ? null : ART[id as keyof typeof ART]
    .replace(/\bid="([^"]+)"/g, (_, name: string) => `id="${instance}-${name}"`)
    .replace(/url\(#([^)]+)\)/g, (_, name: string) => `url(#${instance}-${name})`);
  return <svg viewBox="0 0 96 96" fill="currentColor" style={{ color: id === "daoxuan-special" ? "white" : "var(--color-brand)" }} className={`shrink-0 rounded-full ${className}`} role="img" aria-label={t("account.avatars.imageLabel", { name: avatarLabel(id) })} data-avatar-id={id}>
    <circle cx="48" cy="48" r="48" fill="var(--color-brand-soft)" />
    {body === null ? <g transform="translate(48 50)">
      {[0, 60, 120, 180, 240, 300].map(angle => <ellipse key={angle} cx="0" cy="-15" rx="8.5" ry="13" fillOpacity=".9" transform={`rotate(${angle})`} />)}
      <circle r="7.5" fill="var(--color-brand-soft)" /><circle r="3.6" />
    </g> : <g data-approved-art={id} dangerouslySetInnerHTML={{ __html: body }} />}
  </svg>;
}
