import { useState } from "react";
import { Trans } from "react-i18next";

import { useI18n } from "../i18n/index.js";
import { Button } from "./Button.js";
import { errorMessage } from "../lib/api.js";
import { useMintReferralCode, useReferralQuota } from "../lib/queries.js";

/**
 * **账户级的邀请码 —— 属于账号，不属于任何一本账。**
 *
 * ⚠️ **This block lives on the account screen, and the owner moved it there on purpose**:
 *
 * > *"用于注册 Libellum 账号的普通或次级邀请码，与加入某一本账本的分享邀请不同。
 * >  前者属于**账号级功能**，适合放在**「账户」的相关设置**中，不需要占据当前账本的协作页面。"*
 *
 * ⚠️ **The two are easy to confuse and behave nothing alike.** A referral code creates a **new
 * account** — with its own ledger and **no access to any of mine** — and all it records is *who
 * invited them*. A share link joins **an existing account to one ledger**. Putting the first on the
 * ledger's collaboration screen invites the reader to think it does the second.
 *
 * ⚠️ **It was on `CollaboratorsPage` and was moved here in S9.5 P3.** The old placement is exactly
 * the mistake the owner's sentence rules out.
 */
export function ReferralCodeSection(): React.JSX.Element {
  const quotaQuery = useReferralQuota();
  const referral = useMintReferralCode();
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const [mintedCode, setMintedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚠️ **The remaining count comes from the server.** A second tally here would eventually disagree
   * with the one the mint path enforces (`教训.md` §8.12) — and the screen would be the one that was
   * wrong.
   *
   * ⚠️ **It used to arrive with the collaborator list**; that list is gone (1.10.05) and the count is
   * now its own question about the account.
   */
  const quota = quotaQuery.data?.quota ?? null;
  const remaining = quota === null ? null : Math.max(0, quota.limit - quota.used);
  const exhausted = remaining !== null && remaining === 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-body text-muted">
          {t("account.referral.heading")}
          {quota === null ? null : (
            <span className="ml-2 text-helper text-muted">
              {t("account.referral.quota", { limit: quota.limit, used: quota.used, remaining: remaining ?? 0 })}
            </span>
          )}
        </h2>

        {open || exhausted ? null : (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            className="shrink-0 text-helper text-brand transition hover:text-brand-dark"
          >
            {t("account.referral.mint")}
          </button>
        )}
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {/**
        * ⚠️ **Exhausted is said out loud, not left as a missing button.** A person who used their
        * three codes and finds the button gone will assume the app is broken or that they forgot
        * something — **while a limit that is stated is simply the rule.**
        */}
      {exhausted ? (
        <p className="rounded-card border border-line bg-surface px-5 py-4 text-body-relaxed text-muted">
          {t("account.referral.exhausted", { count: quota?.limit ?? 3 })}
        </p>
      ) : null}

      {mintedCode === null ? null : (
        <div className="rounded-card border border-brand bg-brand-soft/40 px-5 py-4">
          <p className="text-helper text-muted">{t("account.referral.codeLabel")}</p>
          <p className="mt-2 rounded-field bg-surface px-3 py-2 text-center font-mono text-lg tracking-widest text-ink">
            {mintedCode}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              fullWidth={false}
              onClick={() => {
                void navigator.clipboard.writeText(mintedCode).catch(() => undefined);
              }}
            >
              {t("account.referral.copy")}
            </Button>
            <Button
              variant="secondary"
              fullWidth={false}
              onClick={() => {
                setMintedCode(null);
                setOpen(false);
              }}
            >
              {t("account.referral.done")}
            </Button>
          </div>
        </div>
      )}

      {open && mintedCode === null ? (
        <div className="rounded-card border border-line bg-surface p-5">
          {/**
            * ⚠️ **The "让新注册的人可以直接把我加为协作者" checkbox is gone (1.10.05).** It chose
            * whether the newcomer would be offered an account-level collaborator relationship, and
            * that whole system was removed on the owner's instruction — so the switch no longer
            * controlled anything. **A checkbox that changes nothing is worse than no checkbox**: it
            * asks the user to make a decision and then ignores it.
            */}
          <p className="text-body-relaxed text-muted">
            <Trans i18nKey="account.referral.explain" components={{ b: <strong className="font-medium text-ink" /> }} />
          </p>

          <div className="mt-4 flex gap-3">
            <Button
              disabled={referral.isPending}
              onClick={() => {
                setError(null);
                void referral
                  .mutateAsync()
                  .then((minted) => {
                    setMintedCode(minted.code);
                  })
                  .catch((caught: unknown) => {
                    setError(errorMessage(caught));
                  });
              }}
            >
              {referral.isPending ? t("account.referral.generating") : t("account.referral.generate")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("account.referral.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-helper-relaxed text-muted">{t("account.referral.referredCannotMint")}</p>
    </section>
  );
}
