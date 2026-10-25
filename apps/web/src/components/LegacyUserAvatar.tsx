import type { AvatarId } from "@libellum/shared";
import { t } from "../i18n/index.js";
export type LegacyAvatarId = Exclude<AvatarId, "flower" | "moon" | "sun" | "star" | "coffee" | "sprout" | "wave" | "daoxuan-special" | "descent-special">;

/** 仅兼容已经被用户保存的旧稿，不在正式选择区继续展示。 */
export function LegacyUserAvatar({ avatarId, label, className = "size-24" }: {
  readonly avatarId: LegacyAvatarId;
  readonly label: string;
  readonly className?: string;
}): React.JSX.Element {
  const id = avatarId;
  const art: Record<LegacyAvatarId, React.ReactNode> = {
    house: <><rect x="27" y="43" width="43" height="33" rx="5" fill="#dfb98c" /><path d="m18 44 30-25 31 25Z" fill="#a76c5b" /><rect x="45" y="54" width="13" height="22" rx="3" fill="#7f9f93" /><rect x="32" y="50" width="9" height="10" rx="2" fill="#fff1cb" /><path d="M67 25v-9" stroke="#a76c5b" strokeWidth="7" strokeLinecap="round" /></>,
    car: <><path d="m29 42 8-17h22l11 20" fill="#a9c7be" /><path d="M18 47q0-8 10-8h39q12 0 12 12v14H18Z" fill="#7b9e92" /><circle cx="32" cy="65" r="9" fill="#586c66" /><circle cx="65" cy="65" r="9" fill="#586c66" /><circle cx="32" cy="65" r="4" fill="#f8efdc" /><circle cx="65" cy="65" r="4" fill="#f8efdc" /><path d="M23 48h7m40 0h5" stroke="#f2d597" strokeWidth="4" /></>,
    bird: <><path d="M22 46q8 28 35 22 22-6 15-30-6-17-23-8l-7 13Z" fill="#9bb8c1" /><path d="m71 37 12 7-12 4" fill="#dcaa72" /><path d="M37 43q-3 18 18 16" fill="#688f9d" /><circle cx="63" cy="37" r="2.5" fill="#425d62" /><path d="m42 70-3 8m18-8 2 8" stroke="#b38c68" strokeWidth="3" strokeLinecap="round" /></>,
    cloud: <><path d="M27 65c-22-2-19-29 0-30 4-24 38-24 42 0 23-1 25 31 2 32Z" fill="#b5cbd0" /><path d="M31 32q7-12 21-9" stroke="#e1ece8" strokeWidth="4" fill="none" strokeLinecap="round" /><path d="m35 76-3 6m19-6-3 6m19-6-3 6" stroke="#8aacb9" strokeWidth="3" strokeLinecap="round" /></>,
    tree: <><path d="M48 50v31" stroke="#b18a67" strokeWidth="8" strokeLinecap="round" /><path d="M27 59C9 49 25 25 37 27c6-22 31-15 33 3 23 14 6 40-13 33Z" fill="#86a888" /><path d="m48 64-9-12m9 6 10-15" stroke="#c2d4aa" strokeWidth="3" strokeLinecap="round" /></>,
    cat: <><path d="m25 38 2-21 20 14 21-14 4 23q18 38-23 40-39-1-24-42Z" fill="#caa17b" /><path d="m32 32 1-7 8 7m20 0 6-7 1 9" fill="#eac3ab" /><path d="M34 49h2m24 0h2" stroke="#615b50" strokeWidth="4" strokeLinecap="round" /><path d="m45 57 4 4 4-4" fill="#986e66" /><path d="M29 59 18 57m11 8-10 3m49-9 11-2m-11 8 10 3" stroke="#9c7b60" strokeWidth="2" strokeLinecap="round" /></>,
    dog: <><path d="M28 31q-22 0-13 32 5 7 15-6m38-26q22 0 13 32-5 7-15-6" fill="#aa8064" /><path d="M28 31q20-17 40 0l2 32q-3 17-23 17-21-2-22-17Z" fill="#d7b78e" /><path d="M35 47h1m23 0h1" stroke="#62584e" strokeWidth="4" strokeLinecap="round" /><ellipse cx="48" cy="62" rx="14" ry="10" fill="#f3e4c8" /><path d="m43 57 5 6 5-6Z" fill="#726052" /></>,
    mushroom: <><path d="m40 48-6 30q13 8 28 0l-7-30" fill="#e6d9b7" /><path d="M16 48q7-33 32-33t33 33q-30 13-65 0Z" fill="#c28772" /><circle cx="37" cy="33" r="6" fill="#f8e7d4" /><circle cx="59" cy="31" r="5" fill="#f8e7d4" /><circle cx="67" cy="44" r="4" fill="#f8e7d4" /><path d="M31 80h34" stroke="#a5b594" strokeWidth="3" strokeLinecap="round" /></>,
    boat: <><path d="M47 17v47" stroke="#ad8769" strokeWidth="3" /><path d="m42 21-23 36h23Z" fill="#e0ad7f" /><path d="m52 25 22 31H52Z" fill="#a4bdaf" /><path d="M17 64h64L67 77H31Z" fill="#8a9f9d" /><path d="M16 83q8-5 16 0t16 0 16 0 16 0" fill="none" stroke="#b5ced0" strokeWidth="3" strokeLinecap="round" /></>,
    lighthouse: <><path d="m38 38-8 42h37l-8-42" fill="#eddbc0" /><path d="m35 53 27 3 2 11-31-3Z" fill="#c58871" /><rect x="37" y="28" width="23" height="13" rx="2" fill="#f1cd7f" /><path d="m32 26 16-13 17 13Z" fill="#809f98" /><path d="M26 79h46" stroke="#91adb1" strokeWidth="5" strokeLinecap="round" /><path d="m24 34-9 3m57-3 9 3" stroke="#edcd89" strokeWidth="3" strokeLinecap="round" /></>,
    fish: <><path d="m64 46 17-13v32L64 55" fill="#ce9f7b" /><ellipse cx="43" cy="49" rx="27" ry="18" fill="#a4bdb7" /><path d="m39 32 9-10 9 14m-17 30 9 9 8-12" fill="#7a9d98" /><circle cx="29" cy="46" r="3" fill="#4c6762" /><path d="M48 42q-8 7 0 14" fill="none" stroke="#d7e1cc" strokeWidth="3" strokeLinecap="round" /><circle cx="19" cy="23" r="4" fill="#c4d7d8" /></>,
    leaf: <><path d="M23 70C11 26 48 17 76 19 80 55 62 83 23 70Z" fill="#91ae85" /><path d="m25 71 37-38m-22 24-1-19m11 8 17 1" fill="none" stroke="#d8dfb7" strokeWidth="3" strokeLinecap="round" /><path d="m24 71-6 9" stroke="#9b956a" strokeWidth="4" strokeLinecap="round" /></>,
    mountain: <><circle cx="69" cy="25" r="10" fill="#edc78c" /><path d="m10 74 30-48 30 48Z" fill="#91aca1" /><path d="m43 74 21-35 23 35Z" fill="#b7c6ae" /><path d="m30 42 10-16 11 18-12-5Z" fill="#f1ead5" /><path d="M17 80h61" stroke="#c5d1b8" strokeWidth="3" strokeLinecap="round" /></>,
  };
  return <svg viewBox="0 0 96 96" className={`shrink-0 rounded-full ${className}`} role="img" aria-label={t("account.avatars.imageLabel", { name: label })} data-avatar-id={id}>
    <circle cx="48" cy="48" r="48" fill="#f7f1e3" />
    {art[id]}
  </svg>;
}
