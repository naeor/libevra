/**
 * **辅助工作区的起始页**（S18）。
 *
 * 第一次打开辅助区、还没有让它承担任何任务时显示：一句话说明跟随 / 独立的区别，以及四个主目的地。
 * 在这里点开一个目的地属于「用户主动在辅助区进入其他页面」，外壳会自动切到独立模式。
 */
import { useNavigate } from "react-router";

import { useI18n } from "../i18n/index.js";
import { usePane, useWorkspaceView } from "../workspace/context.js";
import { DestinationIcon, useDestinations } from "../workspace/SecondaryNav.js";

export function WorkspaceStartPage(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const destinations = useDestinations();
  const view = useWorkspaceView();
  const pane = usePane();
  const follow = view?.state.mode === "follow" && pane.role === "secondary";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[40rem] flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-page-title text-ink">{t("workspace.start.title")}</h1>
        <p className="text-body-relaxed text-muted">{follow ? t("workspace.start.follow") : t("workspace.start.independent")}</p>
      </header>
      <section aria-label={t("workspace.start.choose")} className="grid grid-cols-2 gap-3">
        {destinations.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              void navigate(item.path);
            }}
            className="flex min-h-24 flex-col items-start justify-between gap-3 rounded-card border border-line bg-surface p-4 text-left text-ink shadow-card transition hover:border-brand/40 hover:bg-brand-soft/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring active:scale-[0.98]"
          >
            <span className="grid size-10 place-items-center rounded-field bg-brand-soft text-brand-dark">
              <DestinationIcon page={item.id} className="size-6" />
            </span>
            <span className="text-body font-medium">{item.label}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
