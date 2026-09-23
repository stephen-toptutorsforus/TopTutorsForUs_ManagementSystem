/**
 * The two local databases that stand in for the two AWS databases.
 *
 * Sync refuses any other name, so a production URL cannot be used by the
 * local command.
 */

export const OPS_DATABASE = "tutorops_ops_dev";
export const SCHOOL_DATABASE = "toptutorsforus_schools";

export function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    return "";
  }
}

export function assertLocalPair(opsUrl: string, schoolUrl: string): void {
  const ops = databaseName(opsUrl);
  const school = databaseName(schoolUrl);
  if (ops !== OPS_DATABASE || school !== SCHOOL_DATABASE) {
    throw new Error(
      `sync only runs with ${OPS_DATABASE} and ${SCHOOL_DATABASE} ` +
        `(got ${ops || "nothing"} and ${school || "nothing"}).`,
    );
  }
}
