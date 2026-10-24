import {
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type LegalDocument,
  type RegistrationConfigResponse,
} from "@libellum/shared";
import { useCallback, useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { AuthSwitcher } from "../components/AuthSwitcher.js";
import { Button } from "../components/Button.js";
import { PasswordField } from "../components/PasswordField.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { errorMessage } from "../lib/api.js";
import { fetchRequiredLegalDocuments } from "../lib/consent.js";
import { fetchRegistrationConfig } from "../lib/registration.js";

type RegistrationAgreement = LegalDocument & { readonly contentHash: string };

/**
 * Create an account.
 *
 * ⚠️ **Two states, one page.** Whether an invite code is required is a *server* rule (S14-A): the
 * page asks `GET /auth/registration-config` and shows the code field only when the answer says so.
 * The same rule is enforced again by `POST /auth/register`, so this is a faithful mirror rather
 * than the gate itself — and an old client that hides the field on an invite-only server is refused.
 *
 * ⚠️ **Exactly three fields are asked of the person**, per the S14-A brief: username, password and
 * its confirmation. The server still wants a display name (it is what the app shows in lists), so
 * the initial nickname is the username; the profile screen can grow an editor later. Existing
 * accounts keep their nicknames — this only decides what a *new* account starts with.
 */
export function RegisterPage(): React.JSX.Element {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const { t, locale } = useI18n();

  const [config, setConfig] = useState<RegistrationConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * ⚠️ **The recovery-code screen is not optional, so a successful signup must not be redirected
   * away from it.** `AuthProvider.register()` sets `user` before it returns, and its last step
   * awaits local persistence — so there is a real render in which `user` exists while
   * `recoveryCode` is still null. The old `if (user && !recoveryCode) Navigate` could fire in that
   * window and skip the only display of the code (S14-A found this in the browser).
   */
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [agreements, setAgreements] = useState<readonly RegistrationAgreement[]>([]);
  const [agreedIds, setAgreedIds] = useState<readonly string[]>([]);
  const [agreementsLoading, setAgreementsLoading] = useState(true);
  const [agreementsError, setAgreementsError] = useState<string | null>(null);

  /**
   * Ask the server which rule applies. The silent refresh matters because registration rules can
   * change while a tab sits open: the owner closes or opens registration, and a page that only
   * checked once would keep offering the wrong form until a reload.
   */
  const loadConfig = useCallback(async (silent: boolean) => {
    try {
      const next = await fetchRegistrationConfig();
      setConfig(next);
      setConfigError(null);
    } catch {
      if (!silent) {
        setConfigError(t("auth.register.configFailed"));
      }
    }
  }, []);

  useEffect(() => {
    void loadConfig(false);
  }, [loadConfig]);

  useEffect(() => {
    function refresh(): void {
      if (document.visibilityState !== "hidden") void loadConfig(true);
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadConfig]);

  useEffect(() => {
    let cancelled = false;

    void fetchRequiredLegalDocuments()
      .then((documents) => {
        if (!cancelled) setAgreements(documents);
      })
      .catch(() => {
        if (!cancelled) {
          setAgreementsError(t("auth.register.agreementsFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setAgreementsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (user && !recoveryCode && !registrationSubmitted) return <Navigate to="/" replace />;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || config === null) return;
    setError(null);

    if (config.inviteRequired && inviteCode.trim() === "") {
      setError(t("auth.register.inviteMissing"));
      return;
    }

    const parsed = registerRequestSchema.safeParse({
      ...(config.inviteRequired ? { inviteCode } : {}),
      username,
      displayName: username.trim(),
      password,
      ...(agreements.length === 0
        ? {}
        : {
            agreements: agreements.map((document) => ({
              documentId: document.id,
              documentVersion: document.version,
              contentHash: document.contentHash,
            })),
          }),
    });

    if (!parsed.success) {
      // zod 提示是 `@libellum/shared` 里的中文原文，按当前界面语言查表显示。
      const issue = parsed.error.issues[0]?.message;
      setError(issue === undefined ? t("auth.register.invalid") : translateSharedMessage(issue));
      return;
    }

    if (password !== confirmPassword) {
      setConfirmError(t("auth.register.passwordMismatch"));
      return;
    }

    if (agreements.length > 0 && !agreements.every((document) => agreedIds.includes(document.id))) {
      setError(t("auth.register.agreementsRequired"));
      return;
    }

    setBusy(true);
    setRegistrationSubmitted(true);
    try {
      const code = await register({
        ...(config.inviteRequired ? { inviteCode: parsed.data.inviteCode ?? "" } : {}),
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        password: parsed.data.password,
        ...(parsed.data.agreements === undefined ? {} : { agreements: parsed.data.agreements }),
      });
      if (code === undefined) {
        // The account exists but the one-time code was not delivered; do not pretend it was shown.
        setRegistrationSubmitted(false);
      }
      setRecoveryCode(code ?? null);
    } catch (caught) {
      setRegistrationSubmitted(false);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <AuthLayout
        title={t("auth.register.recoveryTitle")}
        subtitle={t("auth.register.recoverySubtitle")}
        guestEntry={false}
      >
        <RecoveryCodeCard
          code={recoveryCode}
          onContinue={() => {
            void navigate("/", { replace: true });
          }}
        />
      </AuthLayout>
    );
  }

  /**
   * A page that cannot learn the rule must not guess one: guessing "open" would try to register
   * under a rule the server may not have, and guessing "invite" would demand a code that may not be
   * needed. The only honest state is "not confirmed yet", with a retry.
   */
  if (config === null) {
    return (
      <AuthLayout
        title={t("auth.register.title")}
        subtitle={t("auth.register.checkingSubtitle")}
        navigation={<AuthSwitcher active="register" />}
      >
        {configError === null ? (
          <p role="status" className="text-body text-muted">
            {t("auth.register.checking")}
          </p>
        ) : (
          <>
            <Alert>{configError}</Alert>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConfigError(null);
                void loadConfig(false);
              }}
            >
              {t("auth.register.retry")}
            </Button>
          </>
        )}
      </AuthLayout>
    );
  }

  const restricted = config.inviteRequired;

  return (
    <AuthLayout
      title={t("auth.register.title")}
      subtitle={restricted ? t("auth.register.subtitleInvite") : t("auth.register.subtitleOpen")}
      navigation={<AuthSwitcher active="register" />}
    >
      {restricted ? <InviteOpennessNotice /> : null}

      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {error === null ? null : <Alert>{error}</Alert>}

        {restricted ? (
          <TextField
            label={t("auth.field.inviteCode")}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            hint={t("auth.register.inviteHint")}
            value={inviteCode}
            onChange={(event) => {
              setInviteCode(event.target.value);
            }}
          />
        ) : null}

        <TextField
          label={t("auth.field.username")}
          hint={t("auth.register.usernameHint")}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!restricted}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <PasswordField
          label={t("auth.field.password")}
          autoComplete="new-password"
          hint={t("auth.field.passwordMin", { min: PASSWORD_MIN_LENGTH })}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmError(null);
          }}
        />

        <PasswordField
          label={t("auth.field.confirmPassword")}
          autoComplete="new-password"
          {...(confirmError === null ? {} : { error: confirmError })}
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setConfirmError(null);
          }}
        />

        {agreementsLoading ? (
          <p className="text-helper text-muted">{t("auth.register.agreementsLoading")}</p>
        ) : null}
        {agreementsError === null ? null : <Alert>{agreementsError}</Alert>}

        {agreements.length > 0 ? (
          <section className="flex flex-col gap-2 rounded-field border border-line p-3">
            {agreements.map((document) => {
              const checked = agreedIds.includes(document.id);
              return (
                <label key={document.id} className="flex items-start gap-3 text-body text-ink">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setAgreedIds((current) =>
                        event.target.checked
                          ? [...current, document.id]
                          : current.filter((id) => id !== document.id),
                      );
                    }}
                    className="mt-1 size-4 shrink-0"
                  />
                  <span className="min-w-0 break-words">
                    {/**
                      * 协议标题是协议文件自己的中文原文（用户同意的就是这份中文），不翻译；
                      * 句子本身随界面语言变化，链接用 `<link>` 嵌在句中，英文语序不被拆碎。
                      */}
                    <Trans
                      i18nKey="auth.register.agree"
                      values={{ title: document.title }}
                      components={{
                        link: (
                          <a
                            href={`/legal/${document.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-brand hover:underline"
                          />
                        ),
                      }}
                    />
                    <span className="block text-helper text-muted">
                      {t("auth.register.documentVersion", { version: document.version })}
                    </span>
                  </span>
                </label>
              );
            })}
            {/** 非中文界面：协议只有中文版本，以中文为准（S16-C-10，英文译本待专业审核）。 */}
            {locale === "zh-CN" ? null : (
              <p className="text-helper-relaxed text-muted">{t("legal.chineseOnly")}</p>
            )}
          </section>
        ) : null}

        <Button type="submit" disabled={busy || agreementsLoading}>
          {busy ? t("auth.register.submitting") : t("auth.register.submit")}
        </Button>
      </form>

      <p className="text-center text-helper-relaxed text-muted">
        {t("auth.register.haveAccount")}
        <Link className="ml-1 font-medium text-brand-dark hover:underline" to="/login">
          {t("auth.register.goLogin")}
        </Link>
      </p>
    </AuthLayout>
  );
}

/**
 * The invite-only explanation.
 *
 * ⚠️ **What it must not say.** The owner ruled out "额度已耗尽 / 服务器资源不足 / 名额用完了": those
 * make a stable policy sound like a shortage, and imply that a scarce thing was taken. The sentence
 * here describes the rule itself — new accounts are opened by invitation — without inventing a
 * reason and without manufacturing urgency. It is also not a modal: it is visible for as long as
 * the field is, and switching between login and register does not interrupt anyone.
 */
function InviteOpennessNotice(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className="rounded-field border border-brand/25 bg-brand-soft/60 px-4 py-3">
      <p className="text-body text-brand-dark">{t("auth.register.inviteNotice")}</p>
      <p className="mt-1 text-helper-relaxed text-muted">{t("auth.register.inviteNoticeDetail")}</p>
    </section>
  );
}
