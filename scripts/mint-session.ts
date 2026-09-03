/**
 * Print a signed session cookie for a seeded account.
 *
 * A development aid for driving the app from curl or a smoke test without
 * posting the sign-in form. It mints the same value the sign-in flow would, so
 * anything it can reach is something a real sign-in can reach too.
 *
 *     npx tsx scripts/mint-session.ts rowan.mercer@example.test
 */

import { config } from "dotenv";

import { clientFor } from "../src/lib/db";
import { issueSession } from "../src/lib/security";

config();

async function main(): Promise<void> {
  const email = process.argv[2] ?? "rowan.mercer@example.test";
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = clientFor(url);
  const user = await db.user.findFirstOrThrow({ where: { email } });
  process.stdout.write(`${issueSession(user.id)}\n`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
