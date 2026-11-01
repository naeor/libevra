import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ComponentProps } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch } from "../lib/api.js";
import { currentMonth, isAllMonths } from "../lib/datetime.js";
import { ensureGuestData, guestDataValue, subscribeGuestData } from "../lib/guest/data.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { monthAvailability, monthsInYear, readMonthSamples } from "../lib/monthAvailability.js";
import { VOLATILE } from "../lib/offline/cache.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { deletedEntriesValue, ledgerSnapshotValue, pendingEntriesValue, readLocalTransactions, subscribeDeleted, subscribeLedger, subscribePending } from "../lib/offline/localLedger.js";
import { offlineScope } from "../lib/offline/scope.js";
import { useCurrentBookId } from "../lib/queries.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { MonthPicker } from "./MonthPicker.js";

type Props = ComponentProps<typeof MonthPicker> & { readonly bookIds?: readonly string[]; readonly render?: (state: {
  year: number; onYearChange: (year: number) => void; availability: ReturnType<typeof monthAvailability>; loading: boolean; statusNote: string;
}) => React.ReactNode };
const NO_IDS: ReadonlySet<string> = new Set();

/** 关闭时不查询；每次打开重新检查，浏览年份与页面选择互不影响。 */
export function LedgerMonthPicker(props: Props): React.JSX.Element | null {
  return props.open ? <OpenLedgerMonthPicker {...props} /> : null;
}

function OpenLedgerMonthPicker({ bookIds: givenBooks, render, ...props }: Props): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const guest = useGuestIdentity();
  const { offline } = useAccountOffline();
  const viewBook = useViewBookId();
  const currentBook = useCurrentBookId();
  const bookIds = givenBooks ?? (viewBook === null ? [] : [viewBook]);
  const [year, setYear] = useState(() => Number((isAllMonths(props.month) ? props.maxMonth : props.month).slice(0, 4)));
  const local = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);
  const pending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const deleted = useSyncExternalStore(subscribeDeleted, deletedEntriesValue, deletedEntriesValue);
  const guestData = useSyncExternalStore(subscribeGuestData, guestDataValue, guestDataValue);
  const ownScope = user !== null && currentBook !== null && offlineScope() === `${user.id}:${currentBook}`;
  const months = [...new Set([...monthsInYear(year), currentMonth()])];

  useEffect(() => {
    if (guest !== null) void ensureGuestData(guest.id);
    else if (ownScope) void readLocalTransactions();
  }, [guest?.id, ownScope, currentBook]);

  const query = useQuery({
    queryKey: ["month-availability", user?.id, bookIds, year, props.maxMonth],
    meta: VOLATILE,
    enabled: guest === null && user !== null && !offline && bookIds.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: ({ signal }) => readMonthSamples(
      months.filter(month => month <= props.maxMonth), bookIds,
      (bookId, month) => apiFetch("/transactions", { bookId, query: { month, limit: 1 }, timeoutMs: 5000 }),
      () => signal.aborted,
    ),
  });
  const availability = monthAvailability({
    months, bookIds,
    samples: offline || query.isFetching ? undefined : query.data,
    local: guest !== null ? guestData?.transactions ?? [] : ownScope ? local : [],
    localBookId: ownScope ? currentBook : null,
    pending: guest !== null || !ownScope ? NO_IDS : pending,
    deleted: guest !== null || !ownScope ? NO_IDS : deleted,
    completeLocal: guest !== null && guestData !== null,
  });
  const loading = guest !== null ? guestData === null : query.isFetching;
  const unknown = months.some(month => month <= props.maxMonth && availability[month] === undefined);
  if (render) return <>{render({ year, onYearChange: setYear, availability, loading,
    statusNote: loading ? t("ledger.monthPicker.loading") : unknown ? t("ledger.monthPicker.unknown") : t("ledger.monthPicker.emptyHint") })}</>;
  return <MonthPicker {...props} year={year} onYearChange={setYear} availability={availability} loading={loading}
    statusNote={loading ? t("ledger.monthPicker.loading") : unknown ? t("ledger.monthPicker.unknown") : t("ledger.monthPicker.emptyHint")} />;
}
