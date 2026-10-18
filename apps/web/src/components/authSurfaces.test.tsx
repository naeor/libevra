import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "./AuthLayout.js";
import { AuthSwitcher } from "./AuthSwitcher.js";
import { GuestEntry } from "./GuestEntry.js";
import { PasswordField } from "./PasswordField.js";
import { TextField } from "./TextField.js";

/**
 * Static content checks for the S14-A account-entry surfaces.
 *
 * ⚠️ **What static rendering can and cannot prove.** It proves the structure and the words: one
 * frame, both entry points, the guest link, the password reveal control's accessible name, and the
 * inline mismatch message. It cannot prove focus, typing or the reveal button's click — those need a
 * DOM and are verified in the real browser during S14-A acceptance, and that is stated rather than
 * implied (same convention as `ConfirmDialog.test.tsx`).
 */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("AuthLayout", () => {
  it("renders the one frame: wordmark, title, content, switch and guest entry", () => {
    const html = render(
      <AuthLayout
        title="登录"
        subtitle="使用用户名和密码继续。"
        navigation={<AuthSwitcher active="login" />}
        footer={<span>忘记密码</span>}
      >
        <TextField label="用户名" />
      </AuthLayout>,
    );

    expect(html).toContain("Libevra");
    expect(html).toContain("登录");
    expect(html).toContain("使用用户名和密码继续。");
    expect(html).toContain("忘记密码");
    expect(html).toContain("创建账号");
    expect(html).toContain("以游客身份继续");
  });

  it("can drop the guest entry where the guest entry is the destination", () => {
    const html = render(
      <AuthLayout title="游客模式" guestEntry={false}>
        <p>游客模式还在准备中，尚未开放。</p>
      </AuthLayout>,
    );

    expect(html).not.toContain("以游客身份继续");
    expect(html).toContain("游客模式还在准备中");
  });
});

describe("GuestEntry", () => {
  it("is a real link to the honest placeholder, not a dead button", () => {
    const html = render(<GuestEntry />);

    expect(html).toContain('href="/guest"');
    expect(html).toContain("以游客身份继续");
  });
});

describe("PasswordField", () => {
  it("renders a masked input and a named reveal control", () => {
    const html = render(<PasswordField label="密码" hint="至少 8 位" />);

    expect(html).toContain('type="password"');
    expect(html).toContain("显示密码");
    expect(html).toContain("至少 8 位");
    expect(html).toContain('aria-pressed="false"');
  });

  it("marks an inline mismatch as an alert tied to the input", () => {
    const html = render(<PasswordField label="确认密码" error="两次输入的密码不一致。" />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("两次输入的密码不一致。");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-describedby=");
  });
});

describe("AuthSwitcher", () => {
  it("offers both entry points and marks the current one", () => {
    const html = render(<AuthSwitcher active="register" />);

    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("创建账号");
  });
});
