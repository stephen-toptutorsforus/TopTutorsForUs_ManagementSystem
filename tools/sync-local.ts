/**
 * Deliver undelivered session changes into the local main database, then
 * apply attendance marks that came back.
 *
 *     npm run sync:local
 *
 * Refuses any database other than tutorops_ops_dev and toptutorsforus_schools.
 */

import { config } from "dotenv";
import { Pool } from "pg";

import { clientFor } from "@/lib/db";
import { assertLocalPair } from "@/lib/services/localDatabases";
import { syncLocal } from "@/lib/services/schoolSync";

config({ path: ".env", quiet: true });

async function main(): Promise<void> {
  const opsUrl = process.env.DATABASE_URL ?? "";
  const schoolUrl = process.env.SCHOOL_DATABASE_URL ?? "";
  assertLocalPair(opsUrl, schoolUrl);

  const ops = clientFor(opsUrl);
  const school = new Pool({ connectionString: schoolUrl });
  try {
    const result = await syncLocal(ops, school);
    console.log(
      `Delivered ${result.delivered} session change${result.delivered === 1 ? "" : "s"}. ` +
        `Applied ${result.attendance} attendance mark${result.attendance === 1 ? "" : "s"}.`,
    );
  } finally {
    await ops.$disconnect();
    await school.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
