# TopTutorsForUs — operations

Multi-tenant tutoring operations: people and roles, instructor availability,
standalone and recurring session booking, a calendar, attendance, and an audit
trail.

Next.js · TypeScript · Prisma · PostgreSQL — the stack the rest of the estate
runs on.

## Status: a port in progress

This is a rewrite of `toptutorsforus_service` (Python / FastAPI / SQLAlchemy /
Jinja), which is still the **reference implementation**. Until this repository
passes the same suite, that one is the source of truth for behaviour and stays
running.

Two consequences worth knowing before touching anything:

- **The database names are different on purpose.** This service uses
  `tutorops_ops_dev` and `tutorops_ops_test`; the Python service owns
  `tutorops_dev` and `tutorops_test`. Pointing this one at those would destroy
  the thing being copied.
- **Table and column names are identical to the Python schema.** A diff between
  the two databases is only meaningful if the names line up, and it leaves open
  the option of moving data across rather than re-seeding.

### Done

**The schema and the correctness core.**

- Prisma schema: 30 tables, 11 native enums.
- Migration, including the four guarantees Prisma cannot express. Verified
  byte-identical to the Python database's, and exercised against direct inserts
  by `tests/db/guarantees.test.ts` — a rule the writer can talk its way around
  is not a guarantee.
- `src/lib/time.ts` — civil dates and times, DST edge policy, the Prisma
  boundary.
- `src/lib/recurrence.ts` — rule expansion, pure, shared by preview and
  generation.
- `src/lib/availability.ts` — the three layers, the organization's bounds, and
  the booking screen's two views of "who is free".
- `src/lib/conflicts.ts` — the four kinds, and a series that clashes with
  itself.

**Authorization**, in `src/lib/policies/`. The permission catalogue and the
floor rule, principals rebuilt from live rows on every request, per-object
session policy, and tenant scoping that answers 404 rather than 403.

**The services**, in `src/lib/services/`. Audit, people, enrolment, groups and
locations, booking, session operations, and the queries behind the grid, the
calendar and the series list.

**Authentication**, in `src/lib/security.ts`. Argon2id, a signed session cookie
carrying an id and nothing else, session-bound CSRF, and in-process rate
limits.

**The screens**, under `src/app/`. Sign-in, a dashboard, the session grid with
CSV export, session detail with every action it admits, the calendar in four
views, series list and detail, booking with live availability and a preview,
availability, the people directory with its create-user modal, groups,
locations, the audit trail, and a help page. The JSON API is under
`/api/v1`, over the same services and the same policy layer.

373 tests: 173 pure and 200 against a database. On top of those, two
differential runs against the Python service — 29,200 civil-time resolutions
and 27,090 recurrence rules — with zero mismatches. See [tools/](tools/).

### Not built, and deliberately so

What is still empty is listed in [docs/product.md](docs/product.md).
Reminders and credit warnings are captured on this machine: nothing is
sent, and nothing is charged. Progress forms, invoicing, and the advanced
classroom stay empty rather than looking implemented.

## Requirements

- Node 20.9+
- PostgreSQL 14+ (18 is what this was developed against)

Postgres specifically, not "any SQL database": exclusion constraints,
`tstzrange`, native enums and `JSONB` are where several correctness guarantees
actually live.

## Setup

```bash
npm install
cp .env.example .env          # then edit it
npm run db:deploy
```

## Run and check

```bash
npm run dev         # http://127.0.0.1:3000
npm test            # the pure-logic suite; no database needed
npm run test:db     # the database-backed suite
npm run lint
npm run typecheck
```

The two suites are separate so a machine with no Postgres can still run and gate
the logic that does not need one.

## The four guarantees that are not in schema.prisma

They live in `prisma/migrations/*/migration.sql`, below a marked line, and must
survive any regeneration of that file.

**Two `EXCLUDE` constraints** make instructor and room double-booking impossible.
This is the one guarantee that cannot be written in application code: a check
followed by an insert leaves a window in which a second request passes the same
check. Both use half-open `tstzrange`, so back-to-back sessions stay legal, and
both are partial, so a cancelled session releases its slot.

**Two rules** make `audit_event` append-only, even to the process that writes it.

**Two partial unique indexes** — one email per tenant, over the rows that have
one; one unbounded role grant per person, which the plain unique constraint
cannot enforce because its `region_id` is NULL and NULLs never collide.
