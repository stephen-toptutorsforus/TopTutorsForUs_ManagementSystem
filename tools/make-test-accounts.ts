/**
 * Put one account per role into the development database.
 *
 *     npm run db:test-accounts
 *
 * The cast, why it exists and what it links up is all in `tools/testAccounts.ts`
 * — this is the command around it, for a database that already holds the
 * export. A reload runs the same function as its last step, so the five
 * accounts survive `tools/load-real-export.ts` without a second command.
 *
 * Adds only. It deletes nothing and touches no imported row, and it refuses any
 * database but `tutorops_ops_dev` for the reason that file states.
 */

import { config } from "dotenv";

import { clientFor } from "../src/lib/db";

import { TEST_PASSWORD, ensureTestAccounts, printAccounts } from "./testAccounts";

config({ path: ".env", quiet: true });

/** The only database this will touch. See `load-real-export.ts` for why. */
const ALLOWED = "tutorops_ops_dev";

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

  const password = flag("password") ?? TEST_PASSWORD;
  const slug = flag("organization");

  const db = clientFor(url);

  const organizations = await db.organization.findMany({
    where: slug ? { slug } : {},
    select: { id: true, name: true, slug: true, timezone: true },
    orderBy: { id: "asc" },
  });
  if (organizations.length === 0) {
    throw new Error(slug ? `no organization with slug ${slug}` : "no organizations here");
  }
  if (organizations.length > 1) {
    throw new Error(
      `${organizations.length} organizations here; say which with --organization <slug>: ` +
        organizations.map((organization) => organization.slug).join(", "),
    );
  }
  const organization = organizations[0]!;

  printAccounts(organization.name, password, await ensureTestAccounts(db, organization, password));

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
