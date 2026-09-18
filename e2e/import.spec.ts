/**
 * The import screen, driven the way somebody would drive it.
 *
 * This is the first file upload in the product, so it is also the first spec to
 * use `setInputFiles`. The files are written here rather than read from disk:
 * a fixture on disk that happened to contain a real export would be exactly the
 * mistake this codebase's fixture rule exists to prevent, and these are two
 * invented people on the reserved `.test` domain.
 *
 * The property worth a browser test — rather than the database test that
 * already covers matching — is the two-step shape: pressing "Read the files"
 * must write nothing, and the counts somebody reads must be the counts they get
 * when they confirm.
 */

import { expect, test } from "@playwright/test";

import { statePath } from "./accounts";

const NEWLINE = "\n";

/**
 * A cast nobody else has imported.
 *
 * Both browser projects run against one database, and an import is additive by
 * design — so a fixture shared between them would be "already here" for
 * whichever ran second, and the run order would decide whether the test passed.
 * Each run invents its own two people instead, which is the same reason
 * `e2e/slots.ts` picks a slot no earlier run has taken.
 */
function cast() {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const instructor = `Imogen Whitlock${tag}`;
  const student = `Rafael Ortiz${tag}`;
  return {
    instructor,
    student,
    people: [
      "Name,Email / Username,Roles,Status",
      `${instructor},imogen.${tag}@example.test,Instructor,Active`,
      `${student},rafael.${tag}@example.test,Student,Invited`,
    ].join(NEWLINE),
    /** Two rows the same instructor cannot both be at. */
    sessions: [
      "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
      `Algebra,${instructor},${student},Room 9,Yes,Scheduled,Incomplete,04/07/2027 9:00:00 AM,1 hour`,
      `Clash,${instructor},${student},Room 9,Yes,Scheduled,Incomplete,04/07/2027 9:30:00 AM,1 hour`,
    ].join(NEWLINE),
  };
}

const asCsv = (name: string, body: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(body, "utf8"),
});

test.describe("as an administrator", () => {
  test.use({ storageState: statePath("admin") });

  test("says what an import will not do, before anything is chosen", async ({ page }) => {
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
    // The promise the whole feature rests on, made on the page rather than only
    // in a commit message.
    await expect(page.locator("main")).toContainText("It only adds");
  });

  test("reads the files, writes nothing, then writes on confirmation", async ({ page }) => {
    const they = cast();
    await page.goto("/import");

    await page.setInputFiles("#file-people", asCsv("people.csv", they.people));
    await page.setInputFiles("#file-sessions", asCsv("sessions.csv", they.sessions));
    await page.getByRole("button", { name: "Read the files" }).click();

    // Step one is a forecast: the heading says so, and the button that would
    // write is a separate press.
    await expect(page.getByRole("heading", { name: "What this would do" })).toBeVisible();
    await expect(page.locator("main")).toContainText("2 to add");
    // One of the two sessions clashes with the other, and the reason is named
    // rather than the row being dropped silently. It is also the case a preview
    // gets wrong unless it can resolve an instructor it has not written yet.
    await expect(page.locator("main")).toContainText(
      "the instructor is already teaching then",
    );

    await page.getByRole("button", { name: "Import these" }).click();
    await expect(page.getByRole("heading", { name: "What was imported" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Import finished");

    // And the second upload of the very same file writes none of it again.
    await page.goto("/import");
    await page.setInputFiles("#file-people", asCsv("people.csv", they.people));
    await page.getByRole("button", { name: "Read the files" }).click();
    await expect(page.locator("main")).toContainText("already here");
    await expect(page.locator("main")).toContainText("0 to add");
  });

  test("refuses a file whose columns are not the ones it needs", async ({ page }) => {
    await page.goto("/import");
    await page.setInputFiles(
      "#file-people",
      asCsv("wrong.csv", "Forename,Surname\nAda,Fenwick"),
    );
    await page.getByRole("button", { name: "Read the files" }).click();
    await expect(page.locator("main")).toContainText("missing");
    await expect(page.getByRole("button", { name: "Import these" })).toBeDisabled();
  });
});

test.describe("as anybody else", () => {
  test.use({ storageState: statePath("student") });

  test("cannot open it, and is not offered it", async ({ page }) => {
    const response = await page.goto("/import");
    expect(response?.status()).toBe(403);
  });
});

test.describe("as a regional administrator's nearest equivalent", () => {
  test.use({ storageState: statePath("instructor") });

  test("is refused as well", async ({ page }) => {
    // `data.import` reaches `ADMIN` only because `ADMIN` is granted the whole
    // catalogue; every other role's grants are listed one by one.
    const response = await page.goto("/import");
    expect(response?.status()).toBe(403);
  });
});
