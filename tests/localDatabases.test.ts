import { describe, expect, it } from "vitest";

import { assertLocalPair, databaseName } from "@/lib/services/localDatabases";

describe("local database pair", () => {
  it("reads the database name from a postgres url", () => {
    expect(databaseName("postgresql://postgres:postgres@127.0.0.1:5432/tutorops_ops_dev")).toBe(
      "tutorops_ops_dev",
    );
  });

  it("accepts only the two local stand-in databases", () => {
    expect(() =>
      assertLocalPair(
        "postgresql://postgres:postgres@127.0.0.1:5432/tutorops_ops_dev",
        "postgresql://postgres:postgres@127.0.0.1:5432/toptutorsforus_schools",
      ),
    ).not.toThrow();
  });

  it("refuses a production-looking database", () => {
    expect(() =>
      assertLocalPair(
        "postgresql://postgres:postgres@127.0.0.1:5432/tutorops_ops_dev",
        "postgresql://user:secret@rds.amazonaws.com:5432/schools",
      ),
    ).toThrow(/toptutorsforus_schools/);
  });
});
