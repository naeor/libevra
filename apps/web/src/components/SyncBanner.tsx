import { useI18n } from "../i18n/index.js";
import { useForeignBookId } from "../lib/workspaceLedger.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";

/**
 * The offline warning.
 *
 * It sits at the very top and stays there for as long as the account is cut off, because the
 * risk it describes is invisible otherwise: the screen keeps showing the last numbers it
 * fetched, and a total that is quietly out of date looks exactly like a total that is
 * correct.
 *
 * ⚠️ **Two signals, one banner.** The owner asked for them to be merged: "当这个判决条件被触发
 * 时或者服务器认为我们不在线（二者任意一项被触发）就默认账号已经离线." So this no longer
 * reads `navigator.onLine` — it reads the shared state, which is offline when **either** the
 * browser says so **or** a request failed to get an answer, and online again only once the
 * browser agrees **and** a request has succeeded.
 *
 * ⚠️ **And it says which of the two it is**, because they lead somewhere different: one is a
 * connection the user can do something about, the other is a server that is not answering and
 * which they can only wait out. A single message saying "check your network" would send half
 * its readers to look at the wrong thing.
 *
 * It also says what the app is doing about it, which is what makes the warning tolerable
 * rather than alarming: the data on screen is real, it came from this device, and anything
 * recorded now is kept until it can be sent.
 */
/**
 * S18：离线下载与同步状态都属于**设备当前账本**；工作区在查看另一本账时不显示（那里的读写只走在线，
 * 这里的说明会误导）。
 */
export function SyncBanner(): React.JSX.Element | null {
  const foreign = useForeignBookId();
  return foreign === null ? <SyncBannerForDevice /> : null;
}

function SyncBannerForDevice(): React.JSX.Element | null {
  const { t } = useI18n();
  const guest = useGuestMode();
  const { offline, reason } = useAccountOffline();
  const { readOnly } = useSharedLedgerOfflineReadOnly();

  /**
   * ⚠️ **S14-C: a guest has no server copy to be offline from.** "Offline" here would describe a
   * sync risk that does not exist — every guest entry is permanently local — so the banner is
   * absent in guest mode instead of alarming someone about a queue that is not there.
   */
  if (guest || !offline) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-30 bg-danger px-5 py-2.5 text-center text-helper-relaxed font-medium text-on-danger"
    >
      {readOnly
        ? /**
           * ⚠️ **Shared ledgers are read-only offline, and the banner must say that rather than
           * promise a sync that cannot happen.** A personal ledger's banner says its local data is
           * real and anything recorded now will be sent later; that sentence would be false here,
           * because a new shared write is refused before it is recorded.
           */
          t("offline.banner.sharedReadOnly")
        : reason === "unreachable"
          ? t("offline.banner.unreachable")
          : t("offline.banner.offline")}
    </div>
  );
}
