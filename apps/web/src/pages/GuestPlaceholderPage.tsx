import { Navigate, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Button } from "../components/Button.js";

/**
 * Where "以游客身份继续" leads — until S14-B makes it mean something.
 *
 * ⚠️ **S14-A builds the entry, not the guest identity.** Guest bookkeeping needs its own local
 * data path, its own scope (the current offline scope is `<账号>:<账本>` and a guest has no
 * account), migration into a real account, and a startup decision that skips this page once a
 * persistent guest identity exists. Those are S14-B. What this page must do now is be a **real
 * destination that tells the truth**: the entry is discoverable, it responds, and it does not
 * pretend a feature is already available.
 *
 * ⚠️ **It is deliberately not a `Navigate` back to `/login`.** A link that silently bounces would
 * look like a broken button; the reader deserves to know that guest mode is on its way and what to
 * do meanwhile. S14-B replaces the body of this page with the guest workspace; the route and the
 * entry points stay.
 */
export function GuestPlaceholderPage(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();

  // A signed-in reader has a real workspace; the guest entry is for people without one.
  if (user) return <Navigate to="/" replace />;

  return (
    <AuthLayout title="游客模式" subtitle="不注册账号，也可以先看看。" guestEntry={false}>
      <section className="rounded-field border border-line bg-canvas px-4 py-4">
        <p className="text-body text-ink">游客模式还在准备中，尚未开放。</p>
        <p className="mt-1.5 text-helper-relaxed text-muted">
          开放后，你可以不创建账号先记一笔；数据默认只保存在这台设备上，需要时可再迁移到正式账号。
        </p>
      </section>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          onClick={() => {
            void navigate("/register");
          }}
        >
          创建账号
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigate("/login");
          }}
        >
          返回登录
        </Button>
      </div>

      <p className="text-center text-helper-relaxed text-muted">
        游客模式开放后，这里会直接进入游客工作台；现在可以先用正式账号记账。
      </p>
    </AuthLayout>
  );
}
