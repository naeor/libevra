import { Link, useLocation, useNavigate } from "react-router";

import { BrandMark } from "../components/BrandMark.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow, ProseSection } from "../components/ui/List.js";
import { useI18n } from "../i18n/index.js";
import { formatAppVersion } from "../lib/version.js";

/**
 * What the project promises, in the user's own words rather than the
 * repository's. Kept short: nobody reads a licence page, but everybody
 * deserves to be told plainly where their data goes.
 *
 * ⚠️ **The way back depends on how the reader arrived, and the owner reported the bug that shows why**
 * (2026-10-13): *"从关于退出会进到设置，从设置退出又会回到关于界面."* This screen is reachable from
 * 设置 **and** from the start page's footer, and a single hard-coded `backTo` made those two
 * indistinguishable — so the reader bounced between 关于 and 设置 instead of returning.
 *
 * ⚠️ **`state.from` is the caller saying where it came from**, and `useGoBack` prefers it over history
 * — see the long note there. **`backTo` stays as the deep-link fallback**, which is the only case it
 * was ever really for: somebody opening `/about` directly has no origin to honour.
 */
export function AboutPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const declared = (location.state as { from?: unknown } | null)?.from;
  const from = typeof declared === "string" ? declared : null;
  const { t } = useI18n();

  return (
    <InnerPage title={t("update.about.title")} backTo={from ?? "/settings"}>
      {/**
        * ⚠️ **S16-A：这一页以阅读为主，所以不再是三张大白卡片。** 所有者：*"当前多个短说明分别装入大卡片，
        * 整体像展示页面。请考虑更自然的文本分节与信息层级，减少不必要的框。"* 现在是：
        *
        * 1. 顶部一行"这是什么"：应用标记、一句话、当前版本（点开就是软件更新）；
        * 2. 三段说明各自一个小标题，靠留白分节，不加外框；
        * 3. 最后是真正可以点的两项（协议文本），用列表行表达"可以去那里"。
        *
        * 文字内容没有改动，只换了排列。
        */}
      <section className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-card"
        >
          <BrandMark className="size-7" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body-relaxed text-ink">{t("common.tagline")}</span>
          <Link to="/update" className="self-start text-helper text-brand transition hover:text-brand-dark">
            {t("update.about.versionLink", { version: formatAppVersion() })}
          </Link>
        </span>
      </section>

      <div className="flex flex-col gap-6 border-t border-line pt-6">
        <ProseSection title={t("update.about.dataTitle")}>
          <p>{t("update.about.dataBody")}</p>
        </ProseSection>

        <ProseSection title={t("update.about.openSourceTitle")}>
          <p>{t("update.about.openSourceBody")}</p>
          {/**
            * ⚠️ **The repository moved with the brand, and this line has to land on the real one**
            * (2026-10-14, Libellum → Libevra). It said `…/libellum` while the remote still had that
            * name — **a link to a repository that does not exist is worse than an old one that
            * does.** The remote was renamed on 2026-10-14 and this line followed it in the same
            * version; GitHub keeps a redirect for the old slug, so old links still resolve.
            * The rename is recorded in `docs/开发过程记录/Libevra品牌迁移记录.md`.
            */}
          <p>
            {t("update.about.repository")}
            <a
              href="https://github.com/naeor/libevra"
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-dark underline decoration-line underline-offset-4 transition hover:decoration-brand"
            >
              github.com/naeor/libevra
            </a>
          </p>
        </ProseSection>

        <ProseSection title={t("update.about.amountsTitle")}>
          <p>{t("update.about.amountsBody")}</p>
        </ProseSection>
      </div>

      {/**
        * ⚠️ **No `state.from` on these two links, on purpose.** `useGoBack` *pushes* a declared origin;
        * declaring `/about` here would make 协议 → 返回 push a second 关于, whose own 返回 (history)
        * then lands back on 协议 — the loop the owner asked to remove. Plain history already returns
        * here, and a deep link still falls back to 设置.
        */}
      <ListGroup title={t("update.about.legal")}>
        <ListRow label={t("update.about.privacy")} to="/legal/privacy" />
        <ListRow label={t("update.about.terms")} to="/legal/terms" />
      </ListGroup>
    </InnerPage>
  );
}
