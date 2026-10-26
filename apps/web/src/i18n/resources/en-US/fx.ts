import type { Messages } from "../../types.js";
import type zh from "../zh-CN/fx.js";
const fx: Messages<typeof zh> = {
  analysisMode: "Analysis mode",
  title: "Currency conversion", hint: "View amounts in your default currency using historical reference rates. Original entries stay unchanged.",
  device: "Saved on this device, separately for each account.", saveError: "Could not save this setting. Check local storage.",
  target: "Reporting currency: {{currency}}", combined: "Combined analysis", separate: "By currency", original: "Original",
  loading: "Loading historical rates…", unavailable: "Rate unavailable", offline: "Offline · using local data", review: "Historical rates need review",
  source: "Source: ECB via Frankfurter", date: "Actual rate date: {{date}}", requested: "Transaction date: {{date}}",
  rate: "1 {{from}} ≈ {{rate}} {{to}}", reference: "Reference conversion. Bank settlement rates may differ.",
  incomplete: "Incomplete statistics", subtotal: "Subtotals include successfully converted entries only", missing: "{{count}} entries could not be converted", showMissing: "View unconverted entries",
  dataIncomplete: "This device does not hold the full date range. These subtotals are not complete totals.",
  error: "Could not read this ledger. Please try again.", retry: "Retry", refresh: "Refresh totals", month: "View month", clearMonth: "Use date range above",
  income: "Income", expense: "Expenses", net: "Net income", category: "Category subtotals", trend: "Monthly trend", complete: "Totals add up the displayed amount of each entry",
  count: "{{count}} entries converted", originalTotals: "Original currency totals", readOnly: "Display only. Recording and editing always use original amounts.",
  capacityError: "This date range has many entries. Please select a shorter range.",
  reasons: { missing_rate: "Historical rate missing", unsupported_currency: "Unsupported currency", invalid_input: "Invalid transaction data", invalid_rate: "Invalid rate data", conflict: "Conflicting rate versions", anomaly: "Rate change needs review", timeout: "Rate request timed out", network: "Rate service unreachable", api_error: "Rate service unavailable", storage_error: "Local rate storage unavailable" },
};
export default fx;
