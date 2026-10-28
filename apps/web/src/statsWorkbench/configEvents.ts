export const WORKBENCH_CHANGED = "libevra-workbench-changed";
export const WORKBENCH_INSTALLED = "libevra-workbench-installed";
export function notifyWorkbenchChange(accountScope: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WORKBENCH_CHANGED, { detail: accountScope }));
}
