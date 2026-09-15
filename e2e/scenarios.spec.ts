/**
 * The awkward cases, against the fixture built for them.
 *
 * `prisma/scenarios.ts` writes every state the calendar can draw and every
 * shape of availability the booking screen can report. These are the
 * assertions that go with it: without the fixture most of them cannot be made
 * at all, because the ordinary seed produces one status out of eight and an
 * instructor who is free all week.
 *
 * **This spec fails rather than skips when the fixture is absent.** Other
 * specs here skip on missing data, and rightly — they are asking about
 * whatever the database happens to hold. This one is asking about data that is
 * meant to exist, and a suite that reports green because it found nothing to
 * check is the failure mode the whole file exists to avoid. The message says
 * how to fix it.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const RUN_THE_FIXTURE =
  "Run `npm run db:scenarios` first — this spec asserts the coverage fixture.";

/** The seven the filter offers. `In progress` is deliberately not among them. */
const FILTERABLE = [
  "Requested",
  "Rejected",
  "Scheduled",
  "Rescheduled",
  "Completed",
  "Cancelled",
  "Missed",
] as const;

/**
 * Every status the calendar names, across the months the fixture spans.
 *
 * Read off the session chips rather than off badge elements: a chip's
 * accessible name already carries its status — "… — Fractions review,
 * Completed, Mon 7 Sep 2026, 10:00 EDT" — and it says so in every view, where
 * the badge markup does not. Three months, because the fixture runs from a week
 * behind today to five weeks ahead, so which month holds which case depends on
 * the day this runs.
 */
async function statusesOnTheCalendar(page: Page): Promise<Set<string>> {
  const seen = new Set<string>();
  await page.goto("/calendar");

  const collect = async () => {
    const labels = await page
      .locator("[data-session-ref]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent ?? ""),
      );
    for (const label of labels) {
      for (const status of FILTERABLE) if (label.includes(`, ${status},`)) seen.add(status);
      if (label.includes(", In progress,")) seen.add("In progress");
    }
  };

  await collect();
  await page.getByRole("button", { name: "Previous month" }).click();
  await collect();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await collect();
  return seen;
}

test.describe("every state the calendar can draw", () => {
  test("shows all seven filterable statuses", async ({ page }) => {
    const seen = await statusesOnTheCalendar(page);

    expect([...seen].sort(), RUN_THE_FIXTURE).toEqual(
      expect.arrayContaining([...FILTERABLE]),
    );
  });

  test("shows In progress too, which the filter does not offer", async ({ page }) => {
    const seen = await statusesOnTheCalendar(page);

    // The mismatch `presentation.test.ts` guards, made visible. Nothing sets
    // this status yet — the Phase 4 classroom will — but the calendar draws it
    // and `BLOCKING_STATUSES` counts it against conflicts, so a session in it
    // is real as far as booking is concerned. It shows while the filter is
    // untouched and disappears the moment any status box is ticked.
    expect(seen.has("In progress"), RUN_THE_FIXTURE).toBe(true);

    // And the filter does not offer it, which is the other half of the
    // mismatch: tick any status box and this session leaves the calendar with
    // no way to ask for it back.
    await expect(page.getByRole("checkbox", { name: "In progress" })).toHaveCount(0);
  });
});

test.describe("a day with more on it than fits", () => {
  test("offers the rest behind a link rather than hiding them", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 720, "the month grid is a list below 720px");

    await page.goto("/calendar");
    // `MONTH_CELL_LIMIT` is 4 and the fixture puts six on one day, so at least
    // one cell has to overflow. Which cell depends on today's date, so this
    // looks for the control rather than for a date.
    const more = page.locator("main .cal-more");
    await expect(more.first(), RUN_THE_FIXTURE).toBeVisible();

    await more.first().click();
    // It opens the day rather than expanding in place: a month cell tall enough
    // to hold six sessions is a month grid that no longer has a shape.
    await expect(page.locator("main")).toContainText(/Busy day \d of 6/);
  });
});

test.describe("the booking screen, against awkward availability", () => {
  /**
   * Choose an instructor by name.
   *
   * Not `selectOption({ label })`: the options read "Kofi Mensah
   * (kofi.mensah@example.test)", because the picker disambiguates two people
   * with the same name by their address. Matching the option and taking its
   * value keeps the test naming a person rather than reciting a format.
   */
  const chooseInstructor = async (page: Page, name: string) => {
    const option = page.locator("#instructor_ref option", { hasText: name }).first();
    await expect(option, `no instructor called ${name} — ${RUN_THE_FIXTURE}`).toHaveCount(1);
    await page.locator("#instructor_ref").selectOption((await option.getAttribute("value"))!);
  };

  const settle = async (page: Page) => {
    await page.waitForTimeout(260);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".availability")).not.toHaveAttribute("aria-busy", "true");
  };

  test("says nobody may teach them, which is not the same as nobody being free", async ({
    page,
  }) => {
    await page.goto("/sessions/new");

    // Ilias Brandt has no `instructor_student` row, and the tenant ships
    // `assigned_users_only`. So this is a relationship to fix, and the message
    // has to send somebody to the assignment screen rather than to the
    // calendar — the two are worded differently on purpose, and sending
    // somebody to the wrong one is what that costs.
    await page.locator("#student_picker").selectOption({ label: "Ilias Brandt" });
    await settle(page);

    const block = page.locator(".availability");
    await expect(block, RUN_THE_FIXTURE).toContainText(
      "No instructors are eligible for the selected student.",
    );
    await expect(block).not.toContainText("none are available at this time");
  });

  test("says an instructor has declared no hours at all", async ({ page }) => {
    await page.goto("/sessions/new");

    // Kofi Mensah is an instructor with no `availability_rule` rows. Every
    // seeded instructor declares Monday to Friday, so this case had no way to
    // occur before the fixture existed.
    const earliest = await page.locator("#start_date").getAttribute("min");
    await page.locator("#start_date").fill(earliest!);
    await settle(page);
    await chooseInstructor(page, "Kofi Mensah");
    await settle(page);

    await expect(page.locator(".availability"), RUN_THE_FIXTURE).toContainText(
      /no declared window|no availability declared/i,
    );
  });

  test("marks an hour the instructor is already teaching, rather than offering it", async ({
    page,
  }) => {
    await page.goto("/sessions/new");

    // The fixture books Marguerite Okonjo solid from 09:00 on one day. Those
    // hours are hers, `instructor_busy` is a conflict no override clears, and
    // the grid has to say so rather than offer a time the write will refuse.
    await page.locator("#student_picker").selectOption({ label: "Ada Fenwick" });
    await settle(page);
    await chooseInstructor(page, "Marguerite Okonjo");
    await settle(page);

    // Which day the fixture made busy is its own arithmetic, and repeating it
    // here would be the same sum written twice and wrong in one of the two
    // places. Ask the JSON API instead — it is the same data the calendar
    // draws, under the same policy checks.
    const busy = await page.evaluate(async () => {
      const response = await fetch("/api/v1/sessions?q=Busy+day&page_size=50");
      if (!response.ok) return null;
      const body = (await response.json()) as {
        results?: { title: string; scheduled_start: { instant: string } | null }[];
      };
      const first = body.results?.find((row) => row.title.startsWith("Busy day"));
      // `instant`, not `local`: the latter is a formatted label — "Fri 18 Sep"
      // — for reading, and the date field wants a date. The fixture's busy
      // sessions run 09:00 to 16:00 in a zone behind UTC, so the instant falls
      // on the same calendar day and slicing it is safe here.
      return first?.scheduled_start?.instant ?? null;
    });
    expect(busy, RUN_THE_FIXTURE).not.toBeNull();

    const day = busy!.slice(0, 10);
    await page.locator("#start_date").fill(day);
    await settle(page);

    // The grid's columns start at the time already in the form, and the form
    // opens at 4 PM while the fixture's busy hours run 09:00 to 16:00 — so at
    // the default the taken cells are all off the left of the table. Moving the
    // start time is what somebody looking for a morning slot would do, and it
    // is what brings them into view.
    await page.locator("#start_time").selectOption("09:00");
    await settle(page);

    // Not free, and marked as taken rather than merely blank — "does not work
    // then" and "is already teaching then" are fixed differently.
    await expect(page.locator(".daygrid td.is-taken").first(), RUN_THE_FIXTURE).toBeVisible();
  });
});
