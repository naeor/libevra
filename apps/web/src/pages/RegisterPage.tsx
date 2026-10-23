import {
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type LegalDocument,
  type RegistrationConfigResponse,
} from "@libellum/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { AuthSwitcher } from "../components/AuthSwitcher.js";
import { Button } from "../components/Button.js";
import { PasswordField } from "../components/PasswordField.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
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
        setConfigError("暂时无法确认当前的注册方式。请检查网络后重试。");
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
          setAgreementsError("暂时无法读取当前协议文件。请刷新页面或稍后再试。");
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
      setError("请填写邀请码。");
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
      setError(parsed.error.issues[0]?.message ?? "请检查填写的内容。");
      return;
    }

    if (password !== confirmPassword) {
      setConfirmError("两次输入的密码不一致。");
      return;
    }

    if (agreements.length > 0 && !agreements.every((document) => agreedIds.includes(document.id))) {
      setError("请先阅读并分别同意每一份当前适用的协议。");
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
        title="恢复码"
        subtitle="账号已创建。请现在保存这个恢复码。"
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
        title="创建账号"
        subtitle="正在确认当前的注册方式。"
        navigation={<AuthSwitcher active="register" />}
      >
        {configError === null ? (
          <p role="status" className="text-body text-muted">
            正在确认当前的注册方式…
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
              重试
            </Button>
          </>
        )}
      </AuthLayout>
    );
  }

  const restricted = config.inviteRequired;

  return (
    <AuthLayout
      title="创建账号"
      subtitle={
        restricted
          ? "创建账号需要邀请码。"
          : "创建你的 Libevra 账号。"
      }
      navigation={<AuthSwitcher active="register" />}
    >
      {restricted ? <InviteOpennessNotice /> : null}

      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {error === null ? null : <Alert>{error}</Alert>}

        {restricted ? (
          <TextField
            label="邀请码"
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            hint="由已有账号在「设置 → 账号安全」生成，或由管理员发放。"
            value={inviteCode}
            onChange={(event) => {
              setInviteCode(event.target.value);
            }}
          />
        ) : null}

        <TextField
          label="用户名"
          hint="3–20 位字母、数字或下划线，用于登录，全站唯一"
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
          label="密码"
          autoComplete="new-password"
          hint={`至少 ${String(PASSWORD_MIN_LENGTH)} 位`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmError(null);
          }}
        />

        <PasswordField
          label="确认密码"
          autoComplete="new-password"
          {...(confirmError === null ? {} : { error: confirmError })}
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setConfirmError(null);
          }}
        />

        {agreementsLoading ? (
          <p className="text-helper text-muted">正在读取当前协议文件…</p>
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
                  <span>
                    我已阅读并同意
                    <a
                      href={`/legal/${document.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 font-medium text-brand hover:underline"
                    >
                      {document.title}
                    </a>
                    。<span className="block text-helper text-muted">版本 {document.version}</span>
                  </span>
                </label>
              );
            })}
          </section>
        ) : null}

        <Button type="submit" disabled={busy || agreementsLoading}>
          {busy ? "创建中…" : "创建账号"}
        </Button>
      </form>

      <p className="text-center text-helper-relaxed text-muted">
        已经有一个账号？
        <Link className="ml-1 font-medium text-brand-dark hover:underline" to="/login">
          去登录
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
  return (
    <section className="rounded-field border border-brand/25 bg-brand-soft/60 px-4 py-3">
      <p className="text-body text-brand-dark">为了保持稳定的使用体验，目前新账号通过邀请开放。</p>
      <p className="mt-1 text-helper-relaxed text-muted">
        邀请码与账本无关；它只用于创建一个独立的账号。
      </p>
    </section>
  );
}
