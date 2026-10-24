import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useJoinViaShareLink, useShareLinkPreview } from "../lib/queries.js";

/**
 * What happens when somebody opens a share link.
 *
 * ⚠️ **Nothing happens until they press the button, and that is the design.**
 *
 * The owner's rule: *"/join/:token 未登录先保存状态，不自动加入；登录后弹窗确认."* So this screen
 * **reads** the link, says **which ledger and what permission**, and waits. A version that joined on
 * open would add people to ledgers from a stray tap on a link in a chat window — and the person who
 * tapped it would have no idea which ledger they had just been added to.
 *
 * ⚠️ **The un-signed-in half is handled by the router, not here.** A visitor with no session is sent
 * to sign in first and comes back to this same URL — so the token survives in the address bar rather
 * than in a state variable that a reload would lose. **A token kept in memory is a token lost by the
 * first page refresh**, and signing in always involves one.
 */
export function JoinPage(): React.JSX.Element {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const preview = useShareLinkPreview(token ?? null);
  const join = useJoinViaShareLink();
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  if (preview.isPending) {
    return (
      <InnerPage title={t("account.join.title")} subtitle={t("account.join.loading")} backTo="/">
        <SkeletonRows rows={2} />
      </InnerPage>
    );
  }

  if (preview.isError) {
    return (
      <InnerPage title={t("account.join.title")} subtitle={t("account.join.invalidSubtitle")} backTo="/">
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="text-body-relaxed text-muted">{t("account.join.invalid")}</p>
          <p className="mt-4 text-helper text-muted">{t("account.join.revokeNote")}</p>
        </div>
      </InnerPage>
    );
  }

  const data = preview.data;

  if (data.alreadyMember) {
    return (
      <InnerPage title={t("account.join.title")} subtitle={t("account.join.alreadySubtitle")} backTo="/">
        <div className="rounded-card border border-line bg-surface p-5">
          <p className="break-words text-body text-ink">{t("account.join.bookName", { name: data.bookName })}</p>
          <p className="mt-2 text-helper-relaxed text-muted">{t("account.join.alreadyMember")}</p>
          <div className="mt-4">
            <Button
              onClick={() => {
                navigate("/start");
              }}
            >
              {t("account.join.goLedgers")}
            </Button>
          </div>
        </div>
      </InnerPage>
    );
  }

  return (
    <InnerPage title={t("account.join.title")} subtitle={t("account.join.confirmSubtitle")} backTo="/">
      {error !== null ? (
        <p role="alert" className="mb-4 rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <div className="rounded-card border border-line bg-surface p-5">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted">{t("account.join.ledger")}</dt>
          <dd className="min-w-0 break-words text-right text-ink">{data.bookName}</dd>

          <dt className="text-muted">{t("account.join.ledgerNumber")}</dt>
          <dd className="min-w-0 text-right font-mono text-ink">{data.bookNumber ?? t("account.join.unassigned")}</dd>

          <dt className="text-muted">{t("account.join.inviter")}</dt>
          <dd className="min-w-0 break-words text-right text-ink">{data.createdByName}</dd>

          <dt className="text-muted">{t("account.join.role")}</dt>
          <dd className="min-w-0 text-right text-ink">
            {data.role === "editor" ? t("account.join.editor") : t("account.join.viewer")}
          </dd>
        </dl>

        <p className="mt-5 border-t border-line pt-4 text-helper-relaxed text-muted">
          {data.role === "editor" ? t("account.join.editorNote") : t("account.join.viewerNote")}{" "}
          {t("account.join.nothingYet")}
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <Button
            disabled={join.isPending}
            onClick={() => {
              setError(null);
              if (token === undefined) return;

              void join
                .mutateAsync(token)
                .then(() => {
                  navigate("/start");
                })
                .catch((caught: unknown) => {
                  setError(errorMessage(caught));
                });
            }}
          >
            {join.isPending ? t("account.join.joining") : t("account.join.confirm")}
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              navigate("/");
            }}
          >
            {t("account.join.notNow")}
          </Button>
        </div>
      </div>
    </InnerPage>
  );
}
