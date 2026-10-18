import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type LegalDocument,
} from "@libellum/shared";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Button } from "../components/Button.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
import { errorMessage } from "../lib/api.js";
import { fetchRequiredLegalDocuments } from "../lib/consent.js";

type RegistrationAgreement = LegalDocument & { readonly contentHash: string };

export function RegisterPage(): React.JSX.Element {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [agreements, setAgreements] = useState<readonly RegistrationAgreement[]>([]);
  const [agreedIds, setAgreedIds] = useState<readonly string[]>([]);
  const [agreementsLoading, setAgreementsLoading] = useState(true);
  const [agreementsError, setAgreementsError] = useState<string | null>(null);

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

  if (user && !recoveryCode) return <Navigate to="/" replace />;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (agreements.length > 0 && !agreements.every((document) => agreedIds.includes(document.id))) {
      setError("请先阅读并分别同意每一份当前适用的协议。");
      return;
    }

    const parsed = registerRequestSchema.safeParse({
      inviteCode,
      username,
      displayName,
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

    setBusy(true);
    try {
      const code = await register({
        inviteCode: parsed.data.inviteCode,
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        password: parsed.data.password,
        ...(parsed.data.agreements === undefined ? {} : { agreements: parsed.data.agreements }),
      });
      setRecoveryCode(code ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCode) {
    return (
      <AuthLayout title="恢复码" subtitle="注册已完成。">
        <RecoveryCodeCard
          code={recoveryCode}
          onContinue={() => {
            void navigate("/", { replace: true });
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="创建账号"
      subtitle="注册需要有效的邀请码：可以请已有账号的人在「设置 → 账号安全」生成，或请管理员发放。"
      footer={
        <>
          已有账号？{" "}
          <Link className="font-medium text-brand-dark hover:underline" to="/login">
            去登录
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {error ? <Alert>{error}</Alert> : null}

        <TextField
          label="邀请码"
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          value={inviteCode}
          onChange={(event) => {
            setInviteCode(event.target.value);
          }}
        />

        <TextField
          label="用户名"
          hint="3–20 位字母、数字或下划线，用于登录，全站唯一"
          autoComplete="username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <TextField
          label="昵称"
          hint={`在应用内显示的名字，可以重复，最多 ${String(DISPLAY_NAME_MAX_LENGTH)} 个字符`}
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />

        <TextField
          label="密码"
          type="password"
          autoComplete="new-password"
          hint={`至少 ${String(PASSWORD_MIN_LENGTH)} 位`}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
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
    </AuthLayout>
  );
}
