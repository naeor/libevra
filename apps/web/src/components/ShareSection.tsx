import { useEffect, useState } from "react";

import { Button } from "./Button.js";
import { CopyButton } from "./CopyButton.js";
import { QrCodeView } from "./QrCodeView.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useCreateShareLink, useRevokeShareLink, useShareLinks, type ShareLinkView } from "../lib/queries.js";

/**
 * **分享链接 —— 一本账的链接邀请。**
 *
 * ⚠️ **Moved here from `LedgerSpacePage` in 1.10.08**, where it was a full module sitting on the
 * start page. The owner's diagnosis: *"开始页承载了过多管理功能，特别是「分享这本账」区域，直接展示分享
 * 权限、有效期、人数限制、生成链接等详细设置，导致页面结构过于复杂."* **All of it moved behind the
 * per-ledger gear**, and this file is what that gear now opens.
 *
 * ⚠️ **`bookId` is required, and the share hooks take it.** The panel is opened *for a ledger the
 * reader may not be in*, so reading the current ledger's links would show one ledger's links under
 * another ledger's name — both halves of the screen plausible, which is the worst shape this bug
 * can take.
 */
export function ShareSection({ bookId }: { readonly bookId: string }): React.JSX.Element {
  /**
    * ⚠️ **Every share call is made against `bookId`, not against the current ledger.** The panel this
    * renders in is opened for the ledger whose gear was tapped, which is not necessarily the one the
    * reader is in — see the note at the top of the file.
    */
  const links = useShareLinks(bookId);
  const create = useCreateShareLink(bookId);
  const revoke = useRevokeShareLink(bookId);
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  /**
   * ⚠️ **Defaults are the permissive end of the owner's ranges** (7 days, 10 people), so a person
   * who does not care gets a usable link. The pickers exist because the ranges are his
   * specification — *"分享链接（1–7 天、1–10 人、可撤销）"* — and **a range that can only be used at
   * one end is not the range he asked for.**
   */
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState(10);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  const all = links.data?.links ?? [];
  const live = all.filter((link) => link.active);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body text-muted">{t("collab.share.heading")}</h2>

      {error !== null ? (
        <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <p className="text-helper-relaxed text-muted">{t("collab.share.intro")}</p>

      {freshToken === null ? (
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-4">
          <Picker
            label={t("collab.share.roleLabel")}
            value={role}
            options={[
              { value: "viewer" as const, label: t("collab.role.viewer") },
              { value: "editor" as const, label: t("collab.role.editor") },
            ]}
            onPick={setRole}
          />

          {/**
            * ⚠️ **The two ranges are stated, not just enforced.** Somebody choosing "3 天" should be
            * able to see that 7 is the maximum, otherwise the picker looks like it simply ran out.
            */}
          <Picker
            label={t("collab.share.daysLabel")}
            value={days}
            options={[1, 3, 7].map((value) => ({ value, label: t("collab.share.days", { count: value }) }))}
            onPick={setDays}
          />

          <Picker
            label={t("collab.share.maxUsesLabel")}
            value={maxUses}
            options={[1, 3, 5, 10].map((value) => ({ value, label: t("collab.share.people", { count: value }) }))}
            onPick={setMaxUses}
          />

          <Button
            fullWidth={false}
            disabled={create.isPending}
            onClick={() => {
              setError(null);
              void create
                .mutateAsync({ role, days, maxUses })
                .then((created) => {
                  setFreshToken(created.token);
                })
                .catch((caught: unknown) => {
                  setError(errorMessage(caught));
                });
            }}
          >
            {create.isPending ? t("collab.share.creating") : t("collab.share.create")}
          </Button>
        </div>
      ) : (
        <div className="rounded-card border border-brand bg-brand-soft/40 px-5 py-4">
          <p className="text-helper text-muted">{t("collab.share.showOnce")}</p>
          <p className="mt-2 break-all rounded-field bg-surface px-3 py-2 font-mono text-helper text-ink">
            {`${window.location.origin}/join/${freshToken}`}
          </p>
          {/**
            * ⚠️ **The link and the symbol sit together, and both are shown.** The owner asked for the
            * QR code *"方便当面扫码加入"* — two people in the same room. **The text stays because the
            * other case is unchanged**: somebody on a call who needs to paste it.
            *
            * ⚠️ **Same string in both**, taken from `window.location.origin` at render time, so a code
            * scanned on a phone points at whatever address the person generating it is actually using —
            * **not at a hostname baked into the bundle**, which would be wrong on every LAN and every
            * self-hosted deployment.
            */}
          <div className="mt-3 flex justify-center">
            <QrCodeView
              text={`${window.location.origin}/join/${freshToken}`}
              label={t("collab.share.qrLabel")}
            />
          </div>

          <p className="mt-2 text-center text-helper text-muted">{t("collab.share.scanHint")}</p>
          {/* S16：英文按钮更长，窄屏允许换行 */}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              fullWidth={false}
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${window.location.origin}/join/${freshToken}`)
                  .catch(() => undefined);
              }}
            >
              {t("collab.share.copyLink")}
            </Button>
            <Button variant="secondary" fullWidth={false} onClick={() => { setFreshToken(null); }}>
              {t("collab.share.saved")}
            </Button>
          </div>
        </div>
      )}

      {/**
        * ⚠️ **Every link is listed, including the dead ones.** An earlier version filtered to the
        * active ones — which meant **`已撤销`、`已过期`、`名额已用完` could never appear**, because a
        * link in those states had already been filtered out. The states existed in the code and were
        * unreachable on screen, which is `教训.md` §8.11 in miniature.
        */}
      {all.length > 0 ? (
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {all.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              busy={revoke.isPending}
              onRevoke={() => {
                setError(null);
                void revoke.mutateAsync(link.id).catch((caught: unknown) => {
                  setError(errorMessage(caught));
                });
              }}
            />
          ))}
        </ul>
      ) : null}

      {links.isSuccess && all.length === 0 ? (
        <p className="text-helper text-muted">{t("collab.share.empty")}</p>
      ) : null}

      {all.length > 0 ? (
        <p className="text-helper-relaxed text-muted">
          {t("collab.share.liveSummary", { count: live.length })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A row of mutually exclusive choices.
 *
 * ⚠️ **Deliberately not a `<select>`.** These are three-to-four options on a phone, and the whole
 * point of *"1–7 天、1–10 人"* is that the person sees the range at a glance — **a dropdown hides
 * exactly the thing the range is for.**
 */
function Picker<T extends string | number>({
  label,
  value,
  options,
  onPick,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onPick: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-helper text-muted sm:w-auto">{label}</span>

      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => {
            onPick(option.value);
          }}
          className={`rounded-field px-3 py-1.5 text-xs transition ${
            option.value === value ? "bg-brand text-on-brand" : "bg-canvas text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function LinkRow({
  link,
  busy,
  onRevoke,
}: {
  readonly link: ShareLinkView;
  readonly busy: boolean;
  readonly onRevoke: () => void;
}): React.JSX.Element {
  const remaining = Math.max(0, link.maxUses - link.useCount);
  const { t } = useI18n();

  /**
   * ⚠️ **Why a link stopped working is shown, not left to be guessed.** The three reasons send the
   * owner to different actions — revoke another link, generate a fresh one, or raise the cap next
   * time — and **"this link no longer works" without a reason is a support question.**
   *
   * S16：这里只决定是哪一种状态（稳定 ID），文字在渲染时按当前语言取。
   */
  const state: "revoked" | "full" | "expired" | null = link.revokedAt !== null
    ? "revoked"
    : remaining === 0
      ? "full"
      : new Date(link.expiresAt).getTime() <= Date.now()
        ? "expired"
        : null;

  return (
    <li className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink">
          {link.role === "editor" ? t("collab.role.editor") : t("collab.role.viewer")}
          {state === null ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">
              {t("collab.share.state.active")}
            </span>
          ) : (
            <span className="rounded-full bg-canvas px-2 py-0.5 text-micro text-muted">
              {t(`collab.share.state.${state}`)}
            </span>
          )}
        </span>

        <span className="text-helper text-muted">
          {t("collab.share.usage", { count: link.days, used: link.useCount, max: link.maxUses })}
          {remaining > 0 ? ` · ${t("collab.share.remaining", { count: remaining })}` : ""}
        </span>

        <span className="text-helper text-muted">
          {link.lastUsedAt === null
            ? t("collab.share.createdOn", { date: link.createdAt.slice(0, 10) })
            : t("collab.share.lastUsedOn", { date: link.lastUsedAt.slice(0, 10) })}
        </span>
      </span>

      {link.revokedAt === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRevoke}
          className="shrink-0 text-helper text-muted transition hover:text-danger disabled:opacity-45"
        >
          {t("collab.share.revoke")}
        </button>
      ) : null}
    </li>
  );
}
