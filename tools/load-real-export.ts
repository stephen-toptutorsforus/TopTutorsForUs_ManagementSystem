/**
 * Replace the development database with a real Pearl export.
 *
 *     npx tsx tools/load-real-export.ts --yes \
 *       --people   ~/Downloads/people.csv \
 *       --sessions ~/Downloads/sessions.csv \
 *       --series   ~/Downloads/series.csv
 *
 * For testing against the roster the office actually has rather than against a
 * cast of invented people. It drops everything in the development database,
 * makes one organization and one administrator who can sign in, and then runs
 * the three files through the **product's own import** — `previewImport` and
 * `commitImport`, the same pair the screen at `/import` calls — so what lands
 * here is exactly what that screen would have written.
 *
 * ## What it will not do
 *
 * **It refuses any database but `tutorops_ops_dev`.** `tutorops_dev` and
 * `tutorops_test` belong to the Python service this one is a port of, and
 * pointing a reset at either would destroy the thing being copied.
 * `tutorops_ops_test` is the suite's, and wiping it mid-run is a confusing way
 * to fail. Checked here rather than trusted to whoever is typing, because the
 * cost of being wrong once is the whole afternoon.
 *
 * **It prints counts and never content.** Not a name, not an address, not a
 * meeting link — the same rule the importer, the audit trail and the refusal
 * messages all follow. The whole point of this file is that it handles real
 * people's data, which makes it the worst possible place to relax that.
 *
 * ## What you get afterwards
 *
 * Imported people arrive as `INVITED` with no password, which is deliberate: an
 * import must not mint working accounts. So none of the roster can sign in, and
 * any one of them can be given a password from their own record in the
 * directory.
 *
 * What *can* sign in is the five test accounts, which this puts back as its
 * last step — see `tools/testAccounts.ts`. That is why a reload is one command
 * rather than two: a refresh that left you locked out of your own database
 * would be a refresh nobody ran twice. They are invented people on the reserved
 * `.test` domain, and they carry the small amount of structure the export
 * cannot supply — declared hours, one assignment, one guardian link — without
 * which the booking screen cannot be walked at all.
 *
 * ## Reloading is the way to follow a fresh export
 *
 * The file has no id column, so matching an exported row to a record already
 * here can only be done on its values, and those collide: measured against this
 * export, 148 session rows and 177 series rows cannot be told apart from a
 * sibling that says something different. An update path built on that is
 * confidently wrong about a twelfth of the file and silent about which twelfth.
 * A reload has no such problem — it is exact by construction.
 *
 * What it costs is anything created *here* since the last one. The day that
 * starts to matter is the day to stop reloading and ask the source system for
 * an id.
 *
 * The fixtures are *not* removed from the repository. `npm run db:seed` and
 * `npm run db:scenarios` still work and are what the browser suite needs; run
 * them again when you want to run the tests, and this script again when you
 * want the real roster back.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { config } from "dotenv";

import { UserStatus } from "../src/generated/prisma/enums";
import { Role } from "../src/generated/prisma/enums";
import { clientFor } from "../src/lib/db";
import { loadPrincipal } from "../src/lib/policies/principal";
import { newRef } from "../src/lib/ref";
import { hashPassword } from "../src/lib/security";
import { commitImport, previewImport } from "../src/lib/services/import";
import type { ImportFiles } from "../src/lib/services/import";

import { ADMIN_EMAIL, TEST_PASSWORD, ensureTestAccounts, printAccounts } from "./testAccounts";

config({ path: ".env", quiet: true });

/** The only database this will touch. */
const ALLOWED = "tutorops_ops_dev";

/**
 * The administrator this leaves behind, so there is somebody to sign in as.
 *
 * On the reserved `.test` domain, which cannot be registered and cannot receive
 * mail — this account is a way in, not a person, and it must not collide with
 * anybody real in the export.
 */
const ADMIN = {
  email: ADMIN_EMAIL,
  firstName: "Operations",
  lastName: "Admin",
};

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const name = databaseName(url);

  if (name !== ALLOWED) {
    throw new Error(
      `DATABASE_URL points at ${name || "nothing"}; this only runs against ${ALLOWED}.`,
    );
  }
  if (!process.argv.includes("--yes")) {
    throw new Error(
      `This deletes everything in ${ALLOWED} and replaces it. Pass --yes to confirm.`,
    );
  }

  const files: ImportFiles = {};
  for (const kind of ["people", "sessions", "series"] as const) {
    const path = flag(kind);
    if (path !== undefined) files[kind] = readFileSync(path, "utf8");
  }
  if (Object.keys(files).length === 0) {
    throw new Error("Give at least one of --people, --sessions, --series.");
  }

  const zone = flag("timezone") ?? "America/Chicago";
  const organizationName = flag("organization") ?? "TopTutorsForUs";
  const password = flag("password") ?? TEST_PASSWORD;

  // A schema drop and every migration again, rather than a table-by-table
  // delete: the hand-written guarantees below the marked line in the migration
  // SQL — the two exclusion constraints, the append-only rules, the partial
  // unique indexes — are re-applied by this and would have to be reasoned about
  // by anything else.
  //
  // No `--skip-seed`: Prisma 7 dropped the flag, and `prisma.config.ts` here
  // declares no seed command, so a reset runs the migrations and stops. If one
  // is ever added to that file, this becomes a reset that immediately puts the
  // fixtures back — which would be obvious from the counts below, but is worth
  // knowing before it is confusing.
  console.info(`Resetting ${ALLOWED}…`);
  execFileSync("npx", ["prisma", "migrate", "reset", "--force"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const db = clientFor(url);

  const organization = await db.organization.create({
    data: {
      ref: newRef("org"),
      name: organizationName,
      slug: "toptutorsforus",
      country: "US",
      timezone: zone,
      currency: "USD",
      features: {},
      // Nothing configured: every default applies, which is what a tenant that
      // has set nothing should look like. `booking.billable_enabled` ships off,
      // so the import writes every session free — see `lib/organization.ts`.
      settings: {},
    },
  });

  const admin = await db.user.create({
    data: {
      ref: newRef("usr"),
      organizationId: organization.id,
      email: ADMIN.email,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      status: UserStatus.ACTIVE,
      timezone: zone,
      passwordHash: await hashPassword(password),
      roles: { create: [{ organizationId: organization.id, role: Role.ADMIN }] },
    },
  });

  const principal = await loadPrincipal(db, admin.id);

  // Through the product, not around it. Every row here is one the import screen
  // would have written, refused for a reason the screen would have named, and
  // recorded in `import_record` so a second run of the same file writes nothing.
  const started = Date.now();
  const preview = await previewImport(db, organization, principal, files);
  const report = await commitImport(db, organization, principal, preview.batchRef);

  console.info(`\nImported in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
  for (const file of report.files) {
    if (file.missing.length > 0) {
      console.info(`  ${file.kind}: missing columns — ${file.missing.join(", ")}`);
      continue;
    }
    const { seen, written, alreadyHere, refused } = file.counts;
    console.info(
      `  ${file.kind.padEnd(9)} ${String(seen).padStart(5)} read` +
        `  ${String(written).padStart(5)} written` +
        `  ${String(alreadyHere).padStart(5)} already here` +
        `  ${String(refused).padStart(5)} refused`,
    );
    // Reasons, which are a fixed vocabulary — never a row, never a name.
    for (const reason of file.reasons) {
      console.info(`      ${String(reason.count).padStart(5)}  ${reason.message}`);
    }
  }

  // Last, and part of the reload rather than a second command to remember: a
  // database nobody can sign in to is not a refreshed one. It runs after the
  // import, so the roster is already here — and the assignment and guardian
  // link it makes are between its own invented people, never a real record.
  printAccounts(organizationName, password, await ensureTestAccounts(db, organization, password));

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
