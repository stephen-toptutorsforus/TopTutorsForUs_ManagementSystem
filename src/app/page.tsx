/**
 * A status page, not a home page.
 *
 * The port has a verified schema and a verified correctness core and no screens
 * at all. A placeholder that looked like a product would misrepresent that; this
 * says plainly what is built, what is not, and what runs the reference
 * implementation in the meantime.
 */

const PORTED = [
  ["Schema and migration", "30 tables · 4 hand-written guarantees"],
  ["Civil time and DST", "29,200-case diff against the reference"],
  ["Recurrence expansion", "27,090-rule diff against the reference"],
  ["Availability", "weekly rules · dated exceptions · time off"],
  ["Conflict detection", "instructor · student · room · availability"],
] as const;

const REMAINING = [
  "Permissions, principals, tenant scoping",
  "Booking and session operations",
  "Queries, calendar ranges, export, audit",
  "Routes and screens",
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-teal-700 dark:text-teal-400">
        Port in progress
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        TopTutorsForUs — operations
      </h1>
      <p className="mt-3 max-w-prose text-slate-600 dark:text-slate-400">
        No screens are built yet. The reference implementation in{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm dark:bg-slate-800">
          toptutorsforus_service
        </code>{" "}
        is still the one to run for anything you need to click.
      </p>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Ported and verified
      </h2>
      <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
        {PORTED.map(([name, detail]) => (
          <li key={name} className="flex flex-wrap justify-between gap-x-6 py-2.5">
            <span>{name}</span>
            <span className="font-mono text-xs text-slate-500">{detail}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Still to come
      </h2>
      <ul className="mt-3 space-y-1.5 text-slate-600 dark:text-slate-400">
        {REMAINING.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <p className="mt-10 border-t border-slate-200 pt-5 text-sm text-slate-500 dark:border-slate-800">
        Liveness at <code>/health</code>, readiness at <code>/health/db</code>.
      </p>
    </main>
  );
}
