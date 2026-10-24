import { Link } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { MemberList } from "../components/MemberList.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { SkeletonRows } from "../components/States.js";
import { isChineseLocale, useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { useBooks, useLedger } from "../lib/queries.js";

/**
 * **「账本 / 协作」主 Tab 下面的三个二级页面。**
 *
 * ⚠️ **These are B-class screens and they look like it on purpose** — white background, a simple
 * title, a back control, `rounded-card` blocks. That style was never wrong; **it was in the wrong
 * place.** The owner's diagnosis: *"这类风格并没有问题，只是它应该用在二级页面，而不是一级 Tab 页面上."*
 *
 * ⚠️ **All three return to `/ledger`**, and the frame's back control prefers real history over that
 * fallback (`useGoBack`), so arriving from the tab and going back lands on the tab.
 */

/** **完整账本信息** —— what the main tab previews four facts of. */
export function LedgerInfoPage(): React.JSX.Element {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const books = useBooks();
  const stats = ledger.data?.stats;
  /** 中文界面保持 `YYYY-MM-DD`（与以前一致），其它语言按当地习惯显示同一个日历日。 */
  const showDate = (localDate: string): string => (isChineseLocale(locale) ? localDate : formatLocalDate(localDate));

  return (
    <InnerPage title={t("books.info.title")} subtitle={ledger.data?.book.name ?? t("books.loadingShort")} backTo="/ledger">
      {ledger.isPending ? <SkeletonRows rows={3} /> : null}

      {ledger.isSuccess ? (
        <dl className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-5 text-sm">
          <dt className="text-muted">{t("books.info.name")}</dt>
          <dd className="min-w-0 text-right break-words text-ink">{ledger.data.book.name}</dd>

          <dt className="text-muted">{t("books.info.number")}</dt>
          <dd className="text-right font-mono text-ink">
            {ledger.data.book.bookNumber ?? t("books.info.unassigned")}
          </dd>

          <dt className="text-muted">{t("books.info.memberCount")}</dt>
          <dd className="text-right text-ink">{t("books.people", { count: ledger.data.book.memberCount ?? 1 })}</dd>

          {stats === undefined ? null : (
            <>
              <dt className="text-muted">{t("books.info.createdAt")}</dt>
              <dd className="text-right text-ink">{showDate(stats.createdAt.slice(0, 10))}</dd>

              <dt className="text-muted">{t("books.info.entryCount")}</dt>
              <dd className="text-right text-ink">{t("common.count.entries", { count: stats.transactionCount })}</dd>

              <dt className="text-muted">{t("books.info.eventCount")}</dt>
              <dd className="text-right text-ink">{t("books.detail.events", { count: stats.eventCount })}</dd>
            </>
          )}

          {books.isSuccess ? (
            <>
              <dt className="text-muted">{t("books.info.totalLedgers")}</dt>
              <dd className="text-right text-ink">{t("books.info.ledgers", { count: books.data.books.length })}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <p className="text-helper-relaxed text-muted">
        {t("books.info.storageNote")}
      </p>

      <Link to="/start" className="text-body text-brand transition hover:text-brand-dark">
        {t("books.info.toSpace")}
      </Link>
    </InnerPage>
  );
}

/** **成员管理** —— 看成员、改权限、邀请新成员。 */
export function LedgerMembersPage(): React.JSX.Element {
  const { t } = useI18n();
  const ledger = useLedger();

  return (
    <InnerPage title={t("books.membersPage.title")} subtitle={ledger.data?.book.name ?? t("books.loadingShort")} backTo="/ledger">
      {/**
        * ⚠️ **The full-strength list, controls included** — this is the page the 协作 tab's 成员 card
        * opens, and the reason that card can stay a glimpse.
        */}
      <MemberList />

      {/**
        * ⚠️ **Inviting lives here in the shared state, and that is the owner's placement**:
        * *"点击后进入当前账本的成员管理。成员管理内可以查看成员、权限以及邀请新成员."*
        *
        * ⚠️ **The lone ledger reaches the same page from its own 邀请成员 section** — one flow, two
        * ways in, so there is nothing to keep in step.
        */}
      {/**
        * ⚠️ **S16-A：邀请是一个去处，所以是一行可点的列表项**，而不是一张带说明和绿色按钮的卡片——
        * 那张卡片和成员列表等重，读起来像页面的第二个主题。说明文字没变，成了这一行的第二行。
        */}
      <ListGroup>
        <ListRow
          label={t("books.members.inviteTitle")}
          detail={t("books.members.inviteHow")}
          to="/ledger/invite"
        />
      </ListGroup>
    </InnerPage>
  );
}
