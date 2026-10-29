# Libevra

**An independent, non-commercial personal finance project.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)


> **Project scope:** Libevra is led and independently developed by [naeor](https://github.com/naeor), with assistance from AI tools. It is a personal, non-commercial project, with no company or operating organization behind it.
> **Not publicly released:** existing private deployments are for personal use and internal testing. They do not constitute a public service or an official cloud offering. Public registration and native client downloads are not available.
> Development status: [docs/STATUS.md](docs/STATUS.md); roadmap: [docs/01-规划.md](docs/01-规划.md).
>
> **⚠️ Formerly Libellum.** Renamed on 2026-10-14 for domain reasons. Which names changed,
> which were deliberately kept, and what still needs a human: [docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md).
>
> **🛠️ Contributing, or an AI assistant picking this up?** Read [AGENTS.md](AGENTS.md) first.
> **Deploying or operating it?** Read [docs/ops/运维-01-生产手册.md](docs/ops/运维-01-生产手册.md) —
> in particular §1 (how to query the *current* state rather than trust a number in a document)
> and §10 (what never to run).

Libevra is a personal finance application for individuals and families, with source code publicly available under AGPL-3.0-only. The current Web application supports self-hosting and offline ledger operations. A complete account-free local PWA, Android and iOS clients, and a packaged self-hosted distribution are planned, not released products.

## Implemented for internal use and testing

The table describes implemented functionality, not public availability or a guarantee that every scenario has been verified. Remaining checks are tracked in [docs/STATUS.md](docs/STATUS.md).

| Area | State |
|---|---|
| Accounts | Username + password, invite-only registration, one-time recovery code (no email needed), several devices per account (one session each; signing out affects only that device) |
| Recording | Income and expenses, categories, payment methods, tags, multiple currencies per ledger, notes, exact time and time zone |
| Detail screen | Per-currency monthly totals, income/expense switch, day-grouped list, filters, soft delete with a 5-second undo |
| Statistics | Trend, category share, period comparison, year overview, calendar heatmap — all drawn as hand-written SVG |
| Screenshot recognition | Send a payment screenshot to the configured server for local OCR inference, review or correct the result, then save. This is server-side recognition, not offline recognition on the device |
| Offline | **Recording, editing, deleting, reading history and statistics all work with no signal**; the queue drains by itself when the network returns, idempotently; two devices that changed the same entry get the non-conflicting fields merged and are asked only about the fields that really disagree |
| Export / import | CSV / XLSX out, CSV back in, with `In-` / `Out-` traceable references |
| Collaboration | Several ledgers per account, owner / editor / viewer, invites with an expiry and a seat count, book messages, share links |
| Not built yet | ~~Chinese-English switch, dark mode and theme-colour picker,~~ public read-only demo account (corrected 2026-10-27: language switch, dark mode and seven theme palettes have shipped; only the demo account remains) |

## How data stays traceable

Anything that crosses the ledger's boundary carries a reference that says which way it went:

```
Out-20261010-153012-a3f9   left this book, minted when the export ran
In-20261010-153012-b7c2    arrived in it, minted when the import ran
```

Every row also records where it came from (`source_ref`) and which import brought it in
(`import_ref`), exports are logged as metadata only — never the rows, never the file — and imports
record how many rows arrived against how many were already present. The shape is enforced by
database CHECK constraints rather than by convention, so a reference that cannot be traced cannot
be written in the first place. Details in
[docs/archive/design/S6-导出与导入-设计决定.md](docs/archive/design/S6-导出与导入-设计决定.md).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query |
| Backend | Node.js + Fastify + TypeScript + Zod |
| Database | PostgreSQL 17 + Prisma (migrations in the repository) |
| OCR | Python sidecar, local inference (RapidOCR), stdin/stdout JSON, no network port |
| Deployment | Docker Compose + Caddy (automatic HTTPS) |
| CI | GitHub Actions: typecheck, migrate on a clean database, test, build |

## Project documents

| Document | What it covers |
|---|---|
| [docs/04-交接.md](docs/04-交接.md) | Handover: where to start, how to run it, where it stands, what is next |
| [docs/02-技术方案.md](docs/02-技术方案.md) | Technical plan: architecture, data model, API, security, deployment, cost |
| [docs/01-规划.md](docs/01-规划.md) | Stage-by-stage build plan with acceptance criteria |
| [docs/archive/logs/开发日志.md](docs/archive/logs/开发日志.md) | Development log: every change, decision and its evidence |
| [docs/01-规划.md](docs/01-规划.md) | Deferred ideas, and the ones deliberately rejected |
| [docs/archive/design/S6-导出与导入-设计决定.md](docs/archive/design/S6-导出与导入-设计决定.md) | Export/import decisions, including the reference scheme above |
| [docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md) | The rename from Libellum: what changed, what was kept, what is still manual |

## Privacy

The application includes no third-party analytics or advertising SDKs. Guest ledgers and offline copies are stored on the device; account data is stored on the configured server. OCR and voice recognition use that server and its local recognition processes, so they are not fully offline device features. Recognition inputs are designed to be processed in memory without persistent storage. These implementation choices are not a blanket security guarantee: formal privacy documentation and release checks remain pending, and end-to-end encryption is not an available capability.

## License

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

In short: you may use, study, modify and share this software freely. But if you run a modified version
as a network service for others, you must publish your modified source too. That is deliberate: this
tool should stay free for its users, and nobody should be able to turn it into a closed service.

**The rename did not change the licence.** [LICENSE](LICENSE) is the official AGPL-3.0 text and
was not touched.

---

中文说明见 [README.zh-CN.md](README.zh-CN.md)。
