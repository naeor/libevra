# Libevra

**The free, open ledger.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-live-brightgreen.svg)](https://libevra.com)

> **Status: live at <https://libevra.com>** (self-hosted, registration is invite-only).
> **It is not open for public sign-up** — the owner runs it for one family, and invites are
> issued by hand. Where development stands right now: [docs/STATUS.md](docs/STATUS.md); the roadmap: [docs/01-规划.md](docs/01-规划.md).
>
> **⚠️ Formerly Libellum.** Renamed on 2026-10-14 for domain reasons. Which names changed,
> which were deliberately kept, and what still needs a human: [docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md).
>
> **🛠️ Contributing, or an AI assistant picking this up?** Read [AGENTS.md](AGENTS.md) first.
> **Deploying or operating it?** Read [docs/03-运维手册.md](docs/03-运维手册.md) — it says how to query the
> *current* state rather than trust a number in a document, and what never to run.

Libevra is an open-source, self-hosted expense tracker for individuals and families. It aims to be
the kind of tool you can hand to a family member: fast on a phone, no ads, no tracking, no account
required with a third party — just your own server and your own data.

## What works today

| Area | State |
|---|---|
| Accounts | Username + password, invite-only registration, one-time recovery code (no email needed), several devices per account (one session each; signing out affects only that device) |
| Recording | Income and expenses, multi-level categories, payment methods, tags, multiple currencies per ledger, notes, exact time and time zone |
| Detail screen | Per-currency monthly totals, income/expense switch, day-grouped list, filters, soft delete with a 5-second undo |
| Analysis | A modular analysis workbench: ready-made analysis cards, filters, optional multi-currency conversion, custom and composite cards, editable layouts with presets, layouts synced per account — all charts drawn as hand-written SVG |
| Screenshot recognition | Upload a payment screenshot, read the fields locally with OCR, confirm or correct, save. Images are never written to disk and never leave the server |
| Offline | **Recording, editing, deleting, reading history and statistics all work with no signal**; the queue drains by itself when the network returns, idempotently; two devices that changed the same entry get the non-conflicting fields merged and are asked only about the fields that really disagree |
| Export / import | CSV / XLSX out, CSV back in, with `In-` / `Out-` traceable references |
| Collaboration | Several ledgers per account, owner / editor / viewer, invites with an expiry and a seat count, book messages, share links |
| Appearance | Chinese / English, light / dark / system, seven theme palettes |
| Not built yet | Public read-only demo account |

## Running it locally

```bash
pnpm install
cp .env.example .env          # then fill in your own database password
pnpm db:generate && pnpm db:deploy
```

On Windows, `start-dev-lan.cmd` is the daily entry: it opens `http://localhost:5173` (API on `127.0.0.1:3000`).
Ports, HTTPS for phones and troubleshooting: [docs/ops/本地开发环境与5173.md](docs/ops/本地开发环境与5173.md); prerequisites and commands: [docs/04-交接.md](docs/04-交接.md) §2.

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
| [AGENTS.md](AGENTS.md) | Rules for contributors and AI assistants: what to read, what needs approval, which checks to run |
| [docs/STATUS.md](docs/STATUS.md) | The single source of the current state |
| [docs/00-索引.md](docs/00-索引.md) | Map of all documents, with what must be read and what is reference or history |
| [docs/01-规划.md](docs/01-规划.md) | Roadmap (the current one-page plan is at the top) |
| [docs/02-技术方案.md](docs/02-技术方案.md) | Technical plan: architecture, data model, API, security, deployment, cost |
| [docs/04-交接.md](docs/04-交接.md) | Handover: how to run it, how the code is organised, how to work with the owner |
| [docs/changelog/1.17.md](docs/changelog/1.17.md) | What each version changed |
| [docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md) | The rename from Libellum: what changed, what was kept, what is still manual |

## Privacy

Libevra ships no analytics and no advertising SDKs. It does not sell data. The only data it holds is
what you enter yourself, on a server you control. Payment screenshots used for recognition are
decoded in memory, never written to disk, and never sent to a third-party service.

## License

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

In short: you may use, study, modify and share this software freely. But if you run a modified version
as a network service for others, you must publish your modified source too. That is deliberate: this
tool should stay free for its users, and nobody should be able to turn it into a closed service.

**The rename did not change the licence.** [LICENSE](LICENSE) is the official AGPL-3.0 text and
was not touched.

---

中文说明见 [README.zh-CN.md](README.zh-CN.md)。
