import { DEFAULT_BOOK_NAME } from "@libellum/shared";

/**
 * The English name for the ledger the server creates by itself.
 *
 * ⚠️ **This has to exist on the server, not just in the interface.** The first ledger is created
 * inside the registration transaction, before the new account has opened a single screen; there
 * is no later moment where the client could rename it without the person watching a write happen
 * that they never asked for. So the request that creates it has to say which language the person
 * is reading, and the server has to answer in that language.
 *
 * ⚠️ **Translated, not transliterated.** `我的账本` is an ordinary possessive — the English is
 * `My Ledger`, not pinyin and not a brand name. An English reader should recognise it as "the
 * default ledger", the same way a Chinese reader recognises `我的账本`.
 */
export const DEFAULT_BOOK_NAME_EN = "My Ledger";

const DEFAULT_BOOK_NAME_ZH = DEFAULT_BOOK_NAME;

/**
 * Choose the default ledger name from an `Accept-Language` header.
 *
 * ⚠️ **Only the interfaces' own two languages are honoured — everything else gets Chinese.**
 * The product's working language, its rules and its legal text are Chinese-first, so a person
 * whose browser asks for a third language still sees Chinese around the ledger name; matching
 * that is more honest than half-translating one string.
 *
 * ⚠️ **The header is untrusted input and must never reach storage at all.** It only selects
 * between two constant strings: no interpolation, no length the server does not control, no way
 * for a header value to become part of a ledger name. A malformed value simply falls back to the
 * Chinese default.
 *
 * The list is read in order (browsers send their preference order); the first language we support
 * wins. Quality factors (`;q=`) are not interpreted beyond that ordering — we do not need a
 * precise negotiation, only "is this person reading English or Chinese".
 */
export function defaultBookNameFor(acceptLanguage: string | undefined): string {
  if (acceptLanguage === undefined || acceptLanguage === "") return DEFAULT_BOOK_NAME_ZH;

  for (const entry of acceptLanguage.split(",")) {
    const tag = (entry.split(";")[0] ?? "").trim().toLowerCase();
    if (tag === "") continue;
    if (tag === "en" || tag.startsWith("en-")) return DEFAULT_BOOK_NAME_EN;
    if (tag === "zh" || tag.startsWith("zh-")) return DEFAULT_BOOK_NAME_ZH;
  }

  return DEFAULT_BOOK_NAME_ZH;
}
