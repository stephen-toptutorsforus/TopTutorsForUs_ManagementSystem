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

/**
 * Switch to the week grid and wait for it.
 *
 * The view switcher submits the calendar's own form — the view is state this
 * screen holds rather than an address it goes to — so the click is a round trip
 * and not a re-render. Asserting straight after it reads the month that is
 * still on screen, which is how three of these first reported that the grid had
 * no hour labels at all.
 */
async function weekView(page: Page): Promise<void> {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".cal-timegrid")).toBeVisible();
}

test.describe("what the calendar says about time", () => {
  test("calls a past scheduled session Incomplete rather than Scheduled", async ({
    page,
  }) => {
    // The fixture leaves one scheduled session in the past on purpose. Nothing
    // moves a session on when its hour passes, so the row still says SCHEDULED
    // — and the calendar has to say what is true rather than what is stored.
    await page.goto("/calendar");
    const labels = await page
      .locator("[data-session-ref]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent ?? ""),
      );
    const mine = labels.find((label) => label.includes("nobody said what happened"));
    expect(mine, RUN_THE_FIXTURE).toBeTruthy();
    expect(mine).toContain("Incomplete");
    expect(mine).not.toContain("Scheduled");
  });

  test("labels every half hour on the week grid, not only the hours", async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) <= 720, "the gutter is narrower below 720px");

    await weekView(page);

    const labels = await page.locator(".tg-time").allTextContents();
    // Forty-eight of them, one per half hour of the day. The grid used to draw
    // twenty-four and throw the rest away, so a session at half past had no
    // line to be read against.
    expect(labels).toContain("9 AM");
    expect(labels, "the half hours were being computed and discarded").toContain("9:30 AM");
    expect(labels.length).toBe(48);
  });
});

test.describe("more than one session in the same hour", () => {
  test("draws them side by side instead of on top of each other", async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) <= 720, "one day at a time below 720px");

    await weekView(page);

    // `assignLanes` has always done this and the stylesheet has always had the
    // classes; nothing in the seed overlapped, so it had never been on screen.
    // It takes two instructors — an instructor cannot overlap themselves,
    // because the exclusion constraint refuses it.
    const overlapping = page.locator(".tg-event[class*='lane-'][class*='-of-2']");
    const found = await overlapping.count();
    if (found === 0) {
      // The fixture's overlapping day may fall in the following week.
      await page.getByRole("button", { name: "Next week" }).click();
    }
    await expect(
      page.locator(".tg-event[class*='-of-2']").first(),
      RUN_THE_FIXTURE,
    ).toBeVisible();

    // Side by side means different left edges, which is the thing a lane class
    // is for and the thing a test can see.
    const boxes = await page.locator(".tg-event[class*='-of-2']").evaluateAll((nodes) =>
      nodes.slice(0, 2).map((node) => Math.round(node.getBoundingClientRect().left)),
    );
    expect(new Set(boxes).size, "two lanes should not share an edge").toBe(boxes.length);
  });

  test("names people on a chip rather than the session's title", async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) <= 720, "one day at a time below 720px");

    await weekView(page);

    // A week of "Weekly maths clinic" says nothing about which one is whose.
    // Who is teaching and who is being taught is what somebody scanning a
    // column is looking for; the title is still in the accessible name.
    const titles = await page.locator(".tg-event-title").allTextContents();
    expect(titles.length, RUN_THE_FIXTURE).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title, "a chip should name people, not the session").not.toMatch(
        /^(Busy day|Overlap:|Scheduled:|Series:)/,
      );
    }
  });
});

test.describe("what Incomplete means", () => {
  /**
   * A tooltip on the one state that cannot be looked up anywhere else.
   *
   * It is worked out when the page is drawn rather than stored, so it is not in
   * the status filter's menu with the other seven — and it is the state that
   * asks the reader to do something. The sentence goes on the chip as a title,
   * and again in the dialog and on the help page, because a title reaches
   * neither touch nor most screen readers.
   */
  test("explains itself on the chip, and only there", async ({ page }) => {
    await page.goto("/calendar");

    const chips = await page.locator("[data-session-ref]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label") ?? node.textContent ?? "",
        title: node.getAttribute("title"),
        state: node.querySelector(".cal-flag")?.textContent ?? "",
      })),
    );
    expect(chips.length, RUN_THE_FIXTURE).toBeGreaterThan(0);

    const incomplete = chips.filter((chip) => chip.state.includes("–"));
    expect(incomplete.length, "the fixture leaves a scheduled session in the past").toBeGreaterThan(0);
    for (const chip of incomplete) {
      expect(chip.title, "an Incomplete chip should say what that means").toMatch(
        /attendance/i,
      );
      expect(chip.title, "and what to do about it").toContain("Mark completed");
    }

    // And nowhere else. A gloss on every badge is a gloss nobody reads, and the
    // other seven are either plain English or in the filter's own menu.
    for (const chip of chips.filter((c) => !c.state.includes("–"))) {
      expect(chip.title, `no title belongs on ${chip.state}`).toBeNull();
    }
  });

  test("says it in words as well, where a title cannot reach", async ({ page }) => {
    await page.goto("/calendar");

    // Visible ones only — a month cell hides what overflows it.
    const chips = page.locator("[data-session-ref]:visible");
    const count = await chips.count();
    for (let index = 0; index < Math.min(count, 30); index += 1) {
      if ((await chips.nth(index).getAttribute("title")) === null) continue;
      await chips.nth(index).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Incomplete");
      // The same sentence, as text, for every touch screen and most screen
      // readers — neither of which ever sees a title.
      await expect(dialog.locator(".peek-meaning")).toContainText("attendance");
      return;
    }
    throw new Error(RUN_THE_FIXTURE);
  });

  test("is written down somewhere a pointer is not needed", async ({ page }) => {
    await page.goto("/help");
    await expect(page.locator("main")).toContainText("Incomplete");
    await expect(page.locator("main")).toContainText("no attendance has been");
  });
});
