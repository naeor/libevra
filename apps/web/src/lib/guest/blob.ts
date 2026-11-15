/**
 * 一本游客账本的数据 blob：形状、预设、种子与读出时的校验（从 `data.ts` 拆出，多账本迁移与载入共用）。
 *
 * ⚠️ **形状没有变**：仍是 `{schemaVersion, book, categories, paymentMethods, tags, transactions, deleted,
 * cleanup?, nextSeq}`，`schemaVersion` 仍是 1。多账本只改变“存在哪个键里”（每本账一个
 * `guest:<游客id>:data:<账本id>`，见 `workspace.ts`），不改 blob 本身，所以旧的单一 `data` blob 可以
 * **原样**搬到新键里，读回逐字段比较即可校验。
 *
 * ⚠️ **`book` 以注册表为准**：账本名称、币种、创建时间的权威来源是注册表（`ledger.ts`），blob 里的
 * `book` 只是写入时的副本。读出时用注册表的那一条覆盖它，所以重命名只需要改注册表。
 */
import {
  UNCATEGORISED,
  categoriesFor,
  PAYMENT_METHOD_NAMES,
  type Category,
  type PaymentMethod,
  type Tag,
  type Transaction,
} from "@libellum/shared";

import type { GuestLedger } from "./ledger.js";

export const GUEST_DATA_SCHEMA_VERSION = 1;

/**
 * 游客本机“导入账单”的一次成功写入（1.19.96）。对应服务器的 `import_logs` 一行 + 写入账目的 `sourceRef`：
 * - `fingerprint`：文件的 SHA-256；同一份文件再导入时整份标成“已经导入过”（服务器同一规则）；
 * - `sourceRefs`：这次写入的来源单号 → 账目 id；换一份导出、同一笔交易再出现时按来源身份跳过。
 *
 * 游客的 `Transaction` 形状与服务器返回的一致、没有 `sourceRef` 字段，所以来源身份记在这里，与账目同在一个
 * blob 里、同一次写入——不会出现“账目写进去了、身份没记上”的半状态。字段是可选的：没导入过账单的账本没有它，
 * blob 版本号不变。转正式账号时不上传它（`guestImportSourceSchema` 没有这一项）。
 */
export interface GuestBillImport {
  /** `In-…`，与服务器导入编号同一格式（`newImportRef`）。 */
  readonly fileRef: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rowCount: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly sourceRefs: Readonly<Record<string, string>>;
}

export interface GuestData {
  readonly schemaVersion: typeof GUEST_DATA_SCHEMA_VERSION;
  readonly book: GuestLedger;
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly transactions: readonly Transaction[];
  /** Entries the guest deleted, kept so the undo button can restore them. */
  readonly deleted: readonly Transaction[];
  /** D5 phase 3: imported guest rows removed after a verified cleanup, kept for local recovery. */
  readonly cleanup?: readonly Transaction[];
  /** 1.19.96：本机导入账单的记录（见 {@link GuestBillImport}）；没导入过就没有这一项。 */
  readonly billImports?: readonly GuestBillImport[];
  readonly nextSeq: number;
}

export function newGuestEntityId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validCategory(value: unknown): value is Category {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    (candidate["kind"] === "income" || candidate["kind"] === "expense") &&
    typeof candidate["isSystem"] === "boolean" &&
    typeof candidate["isArchived"] === "boolean" &&
    typeof candidate["sortOrder"] === "number"
  );
}

function validPaymentMethod(value: unknown): value is PaymentMethod {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    typeof candidate["isArchived"] === "boolean" &&
    typeof candidate["sortOrder"] === "number"
  );
}

function validTag(value: unknown): value is Tag {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    typeof candidate["color"] === "string"
  );
}

function validTransaction(value: unknown): value is Transaction {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    (candidate["kind"] === "income" || candidate["kind"] === "expense") &&
    typeof candidate["amountCents"] === "number" &&
    typeof candidate["currency"] === "string" &&
    typeof candidate["categoryId"] === "string" &&
    typeof candidate["categoryName"] === "string" &&
    typeof candidate["occurredAt"] === "string" &&
    typeof candidate["occurredLocalDate"] === "string" &&
    typeof candidate["version"] === "number"
  );
}

function validBillImport(value: unknown): value is GuestBillImport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const refs = candidate["sourceRefs"];
  return (
    typeof candidate["fileRef"] === "string" &&
    typeof candidate["fingerprint"] === "string" &&
    typeof candidate["createdAt"] === "string" &&
    typeof candidate["rowCount"] === "number" &&
    typeof candidate["importedCount"] === "number" &&
    typeof candidate["skippedCount"] === "number" &&
    typeof refs === "object" && refs !== null && !Array.isArray(refs) &&
    Object.values(refs).every((id) => typeof id === "string")
  );
}

function presetCategories(): Category[] {
  const categories: Category[] = [];
  let order = 0;

  for (const kind of ["expense", "income"] as const) {
    for (const preset of categoriesFor(kind)) {
      categories.push({
        id: newGuestEntityId(),
        name: preset.name,
        kind,
        description: preset.description,
        isSystem: false,
        isArchived: false,
        sortOrder: order,
      });
      order += 1;
    }
  }

  for (const kind of ["expense", "income"] as const) {
    categories.push({
      id: newGuestEntityId(),
      name: UNCATEGORISED.name,
      kind,
      description: null,
      isSystem: true,
      isArchived: false,
      sortOrder: 9_000,
    });
  }

  return categories;
}

function presetPaymentMethods(): PaymentMethod[] {
  return PAYMENT_METHOD_NAMES.map((name, index) => ({
    id: newGuestEntityId(),
    name,
    isArchived: false,
    sortOrder: index,
  }));
}

/**
 * 一本新账本的初始数据：自己的一套预设分类与支付方式，没有账目。
 *
 * ⚠️ 与正式账号新建账本同一规则（`routes/books.ts`）：**不从当前账本复制**分类与支付方式——复制会把
 * 一本账的自定义悄悄带进本来想分开的另一本。
 */
export function seedGuestData(book: GuestLedger): GuestData {
  return {
    schemaVersion: GUEST_DATA_SCHEMA_VERSION,
    book,
    categories: presetCategories(),
    paymentMethods: presetPaymentMethods(),
    tags: [],
    transactions: [],
    deleted: [],
    cleanup: [],
    nextSeq: 1,
  };
}

/** 这个值是不是本版本认得的账本 blob（只看版本号与是否为对象，不看内容）。认不出的一律不覆盖。 */
export function isRecognisedGuestBlob(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["schemaVersion"] === GUEST_DATA_SCHEMA_VERSION
  );
}

/**
 * 一个 blob 里有没有用户的账目（活的、已删除待撤销的、迁移后清理留档的任意一种）。
 * 迁移时用它判断“重新出现的旧键”是否值得另存一份（见 `workspace.ts` 的分叉处理）。
 */
export function guestBlobHasEntries(value: unknown): boolean {
  if (!isRecognisedGuestBlob(value)) return false;
  return ["transactions", "deleted", "cleanup"].some((field) => {
    const list = value[field];
    return Array.isArray(list) && list.length > 0;
  });
}

/**
 * Read a persisted blob defensively; a damaged blob is treated as absent rather than rendered.
 *
 * `book` 是注册表里的那一条，覆盖 blob 里存的副本（见文件头）。
 */
export function normalizeGuestBlob(value: unknown, book: GuestLedger): GuestData | null {
  if (!isRecognisedGuestBlob(value)) return null;
  const candidate = value;

  const categories = Array.isArray(candidate["categories"])
    ? candidate["categories"].filter(validCategory)
    : [];
  const paymentMethods = Array.isArray(candidate["paymentMethods"])
    ? candidate["paymentMethods"].filter(validPaymentMethod)
    : [];
  const tags = Array.isArray(candidate["tags"]) ? candidate["tags"].filter(validTag) : [];
  const transactions = Array.isArray(candidate["transactions"])
    ? candidate["transactions"].filter(validTransaction)
    : [];
  const deleted = Array.isArray(candidate["deleted"])
    ? candidate["deleted"].filter(validTransaction)
    : [];
  const cleanup = Array.isArray(candidate["cleanup"])
    ? candidate["cleanup"].filter(validTransaction)
    : [];
  // 只在存过时带上（没导入过账单的 blob 读出来仍与原来逐字段相同）。
  const billImports = Array.isArray(candidate["billImports"])
    ? candidate["billImports"].filter(validBillImport)
    : null;

  return {
    schemaVersion: GUEST_DATA_SCHEMA_VERSION,
    book,
    categories,
    paymentMethods,
    tags,
    transactions,
    deleted,
    cleanup,
    ...(billImports === null ? {} : { billImports }),
    nextSeq:
      typeof candidate["nextSeq"] === "number" && candidate["nextSeq"] > 0
        ? candidate["nextSeq"]
        : transactions.length + 1,
  };
}

/**
 * 两个可结构化克隆的普通值是否完全相同（对象按键比较，不看键的顺序）。
 *
 * 迁移的“读回校验”用它：写进 IndexedDB 再读出来的值应当与写入的值逐字段一致；不一致就当作没写成功。
 */
export function sameGuestValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null || typeof left !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameGuestValue(item, right[index]));
  }

  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  if (keys.length !== otherKeys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameGuestValue(a[key], b[key]));
}
