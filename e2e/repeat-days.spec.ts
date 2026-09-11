/**
 * The repeat panel, and the clock beside it.
 *
 * The panel only exists above one session, its first row is the session date
 * said again, and it may not name more weekdays than the run has sessions.
 * All three are relationships between controls rather than properties of any
 * one of them, which is why they are asked of a browser: each half looks
 * correct on its own.
 *
 * The clock is here for a plainer reason. It replaced the browser's own time
 * picker, which closed on the first choice, so what is worth pinning is that
 * hour, minute and meridiem are now one choice from one list.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const PANEL = ".repeat-panel";
const ROWS = ".repeat-row";

/** The next Monday, so a chosen date's weekday is known without reading it back. */
function nextMonday(): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

/**
 * The form's own debounce, mirrored — see `e2e/booking.spec.ts`. The panel
 * seeds its first row from the *returned* context, so a wait that stops before
 * the request has even been sent reads the length and time from before the
 * change and this file would report a bug the screen does not have.
 */
const REFRESH_DELAY_MS = 200;

async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(REFRESH_DELAY_MS + 60);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".availability")).not.toHaveAttribute("aria-busy", "true");
}

async function openBooking(page: Page): Promise<void> {
  await page.goto("/sessions/new");
  await expect(page.locator("h1")).toHaveText("Session Booking");
  await page.locator("#start_date").fill(nextMonday());
  await settled(page);
}

/** Ask for a run of this many sessions. */
async function sessions(page: Page, count: number): Promise<void> {
  await page.locator("#occurrence_count").fill(String(count));
  await page.locator("#occurrence_count").dispatchEvent("change");
}

test.describe("the repeat panel", () => {
  test("appears only once the run is more than one session", async ({ page }) => {
    await openBooking(page);
    await expect(page.locator(PANEL)).toBeHidden();

    await sessions(page, 3);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(1);

    await sessions(page, 1);
    await expect(page.locator(PANEL)).toBeHidden();
  });

  test("keeps a count typed while the last one is still in flight", async ({ page }) => {
    // Waiting out the debounce first, so the request for three is genuinely on
    // the wire when the one is typed. Its reply echoes three, and taking that
    // echo would put both the number and the panel back.
    await openBooking(page);
    await sessions(page, 3);
    await page.waitForTimeout(REFRESH_DELAY_MS + 20);

    await sessions(page, 1);
    await settled(page);

    await expect(page.locator("#occurrence_count")).toHaveValue("1");
    await expect(page.locator(PANEL)).toBeHidden();
  });

  test("starts on the session date's own weekday, length and time", async ({ page }) => {
    // The first row is those three fields said again in the shape the rest of
    // the run is said in, so it must not open on a different day from the one
    // above it.
    await openBooking(page);
    await page.locator("#duration_minutes").selectOption("90");
    await settled(page);
    await page.locator("#start_time").selectOption("17:30");
    await settled(page);

    await sessions(page, 4);

    await expect(page.locator("#repeat_weekday_0")).toHaveValue("mon");
    await expect(page.locator("#repeat_length_0")).toHaveValue("90");
    await expect(page.locator("#repeat_time_0")).toHaveValue("17:30");
  });

  test("follows the session date when it moves", async ({ page }) => {
    await openBooking(page);
    await sessions(page, 4);
    // Settled before touching the date. The form is submitted by React and
    // React resets it afterwards, so an edit made while a refresh is in flight
    // is discarded — see the note in `BookingForm`. This test is about the
    // panel following the date, not about that race.
    await settled(page);
    await expect(page.locator("#repeat_weekday_0")).toHaveValue("mon");

    // The Wednesday of the same week. The date is the stronger statement, so
    // the row follows it rather than the two disagreeing.
    const wednesday = new Date(`${nextMonday()}T00:00:00Z`);
    wednesday.setUTCDate(wednesday.getUTCDate() + 2);
    await page.locator("#start_date").fill(wednesday.toISOString().slice(0, 10));
    await settled(page);

    await expect(page.locator("#repeat_weekday_0")).toHaveValue("wed");
  });

  test("adds days up to the number of sessions, then stops offering", async ({ page }) => {
    // Three sessions cannot usefully name four weekdays: the fourth would
    // never come round, and the preview would be short of what was asked for.
    await openBooking(page);
    await sessions(page, 3);

    const add = page.getByRole("button", { name: "Add Day" });
    await add.click();
    await expect(page.locator(ROWS)).toHaveCount(2);
    await add.click();
    await expect(page.locator(ROWS)).toHaveCount(3);
    await expect(add).toHaveCount(0);
    await expect(page.locator(PANEL)).toContainText("Up to 3 days");
  });

  test("trims the rows when the run is shortened under them", async ({ page }) => {
    await openBooking(page);
    await sessions(page, 4);
    await page.getByRole("button", { name: "Add Day" }).click();
    await page.getByRole("button", { name: "Add Day" }).click();
    await expect(page.locator(ROWS)).toHaveCount(3);

    await sessions(page, 2);
    await expect(page.locator(ROWS)).toHaveCount(2);
  });

  test("never offers one weekday twice, and can drop a row", async ({ page }) => {
    await openBooking(page);
    await sessions(page, 4);
    await page.getByRole("button", { name: "Add Day" }).click();

    // The second row cannot be set to the first row's day, because the action
    // refuses two rows on one weekday and an always-refused option should not
    // be offered.
    const second = page.locator("#repeat_weekday_1");
    await expect(second.locator('option[value="mon"]')).toHaveCount(0);
    await expect(second.locator('option[value="tue"]')).toHaveCount(1);

    // The first row's own day stays in its own list, so it is not stuck.
    await expect(page.locator('#repeat_weekday_0 option[value="mon"]')).toHaveCount(1);

    await page.getByRole("button", { name: /^Remove Tuesday/ }).click();
    await expect(page.locator(ROWS)).toHaveCount(1);
    // The last row cannot be removed — a repeating run needs a day.
    await expect(page.getByRole("button", { name: /^Remove Monday/ })).toBeDisabled();
  });

  test("previews a run whose days differ, without changing the address", async ({
    page,
  }) => {
    await openBooking(page);
    await page.locator("#title").fill("Algebra practice");

    // A real booking needs a student and an instructor who may teach them. The
    // seed assigns each student to exactly one, so choosing the student leaves
    // one name in the list.
    await page.locator("#student_picker").selectOption({ label: "Teo Vasquez" });
    await settled(page);
    await page.locator("#instructor_ref").selectOption({ index: 1 });
    await settled(page);

    await sessions(page, 4);
    await page.getByRole("button", { name: "Add Day" }).click();

    await page.locator("#repeat_weekday_1").selectOption("wed");
    await settled(page);
    await page.locator("#repeat_length_1").selectOption("30");
    await settled(page);
    await page.locator("#repeat_time_1").selectOption("17:30");
    await settled(page);

    await page.getByRole("button", { name: /^Preview session/ }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".preview-list")).toBeVisible();

    // Four sessions alternating between the two days, and no refusal.
    await expect(page.locator(".booking .notice-bad")).toHaveCount(0);
    // Four sessions, alternating Monday and Wednesday.
    await expect(page.locator(".preview-list .preview-item")).toHaveCount(4);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      "/sessions/new",
    );
  });
});

test.describe("the chosen tutor's availability, a row per day", () => {
  /** A run of four on Monday and Wednesday, with one instructor chosen. */
  async function twoDayRun(page: Page): Promise<void> {
    await openBooking(page);
    // Choosing the student leaves exactly one eligible instructor, so which
    // tutor the table is about is not left to the order of a dropdown.
    await page.locator("#student_picker").selectOption({ label: "Teo Vasquez" });
    await settled(page);
    await page.locator("#instructor_ref").selectOption({ index: 1 });
    await settled(page);

    await sessions(page, 4);
    await settled(page);
    await page.getByRole("button", { name: "Add Day" }).click();
    await settled(page);
    await page.locator("#repeat_weekday_1").selectOption("wed");
    await settled(page);
  }

  test("shows one row per repeat day once a tutor is chosen", async ({ page }) => {
    await twoDayRun(page);

    const table = page.locator('table[aria-labelledby="weekplan-heading"]');
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(table.locator("tbody tr th").first()).toContainText("Monday");
    await expect(table.locator("tbody tr th").nth(1)).toContainText("Wednesday");

    // A third day is a third row.
    await page.getByRole("button", { name: "Add Day" }).click();
    await settled(page);
    await expect(table.locator("tbody tr")).toHaveCount(3);
  });

  test("names the date each weekday resolves to", async ({ page }) => {
    // The row is only checkable if it says which date it is about — the
    // availability shown is that date's, exceptions and time off included.
    await twoDayRun(page);

    const rows = page.locator('table[aria-labelledby="weekplan-heading"] tbody tr th');
    await expect(rows.first()).toContainText(/Monday, \w{3} \d+/);
    await expect(rows.nth(1)).toContainText(/Wednesday, \w{3} \d+/);
  });

  test("says each row's own length, and follows it when it changes", async ({ page }) => {
    await twoDayRun(page);
    const wednesday = page
      .locator('table[aria-labelledby="weekplan-heading"] tbody tr')
      .nth(1);
    // A new row is seeded with the length the fields above hold, which is the
    // tenant's shortest offering until somebody changes it.
    await expect(wednesday.locator("th")).toContainText("15 minutes");

    await page.locator("#repeat_length_1").selectOption("90");
    await settled(page);
    await expect(wednesday.locator("th")).toContainText("1 hour 30 minutes");
  });

  test("picking a cell sets that day's start time and nothing else's", async ({
    page,
  }) => {
    await twoDayRun(page);
    const times = () =>
      page.locator('.repeat-row select[name="repeat_time"]').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLSelectElement).value),
      );
    const before = await times();

    // Any quarter but one already chosen — pressing the cell a row is already
    // set to would prove nothing about which row changed. Which of these days
    // has cells inside the tutor's declared hours depends on when the database
    // was seeded, and no longer matters: every quarter is pressable.
    const cell = page
      .locator('table[aria-labelledby="weekplan-heading"] button.quartercell:not(.is-chosen)')
      .first();
    // The time the cell stands for, from where it sits: the columns are the
    // twenty-four hours of the day from midnight, each divided into quarters.
    // Read from the position rather than the label, because the grid's header
    // drops a ":00" that the select keeps — one says "5 PM" where the other
    // says "5:00 PM".
    const [column, quarter] = await cell.evaluate((node) => {
      const td = node.closest("td") as HTMLTableCellElement;
      return [
        td.cellIndex - 1,
        [...td.querySelectorAll(".quartercell")].indexOf(node),
      ];
    });
    const expected = `${String(column).padStart(2, "0")}:${String(quarter * 15).padStart(
      2,
      "0",
    )}`;

    await cell.click();
    await settled(page);

    const after = await times();
    expect(after).toHaveLength(before.length);
    const changed = after.filter((value, index) => value !== before[index]);
    expect(changed, "exactly one day's time should have changed").toEqual([expected]);
  });

  test("spans the whole day, an hour a column, wherever the session starts", async ({
    page,
  }) => {
    // The axis is the day, not a window around the current start time. That is
    // what lets a run hold an early class and an evening one, and it is what
    // keeps the table still while somebody works down it.
    await twoDayRun(page);
    const headings = page.locator(
      'table[aria-labelledby="weekplan-heading"] thead th:not(.daygrid-who)',
    );
    await expect(headings).toHaveCount(24);
    await expect(headings.first()).toHaveText("12 AM");
    await expect(headings.nth(13)).toHaveText("1 PM");
    await expect(headings.last()).toHaveText("11 PM");
  });

  test("divides each hour into the quarters a session can start at", async ({ page }) => {
    // An hour a column is what makes a whole day readable; a quarter is what
    // the length and time controls above actually offer. Both, or the table
    // can only ever set a time on the hour.
    await twoDayRun(page);
    const first = page
      .locator('table[aria-labelledby="weekplan-heading"] tbody tr')
      .first();
    const midnight = first.locator("td").first().locator(".quartercell");
    await expect(midnight).toHaveCount(4);
    await expect(first.locator(".quartercell")).toHaveCount(24 * 4);

    for (const [index, label] of [":00", ":15", ":30", ":45"].entries()) {
      await expect(midnight.nth(index)).toContainText(label);
    }
    // Spoken as the whole time, spelled the way the Start time field spells it
    // — the column heading's "12 AM" is not a name for a quarter past.
    await expect(midnight.nth(2)).toContainText("12:30 AM");
  });

  test("offers every time of day, drawn alike", async ({ page }) => {
    // `outside_availability` is an overridable conflict rather than a refusal,
    // and the Start time select above offers the whole day — so the table does
    // not narrow times, and does not shade as though it did. Every quarter of
    // every hour is one pressable control like any other.
    await twoDayRun(page);
    const first = page
      .locator('table[aria-labelledby="weekplan-heading"] tbody tr')
      .first();
    await expect(first.locator("button.quartercell")).toHaveCount(24 * 4);
    await expect(first.locator(".quartercell:not(button)")).toHaveCount(0);

    // 3 AM is well outside anything the seed declares, and still sets the time.
    const small = first.locator("td").nth(3).locator(".quartercell").first();
    await small.click();
    await settled(page);
    await expect(page.locator('.repeat-row select[name="repeat_time"]').first()).toHaveValue(
      "03:00",
    );
  });

  test("keeps Preview and Book on screen above it", async ({ page }) => {
    // The grid is the whole day, and on a narrow screen an hour a row, so a run
    // of three weekdays is taller than the rest of the form together. The
    // actions used to sit below all of it — measured at 3,751px down an 844px
    // viewport — and Book only exists once Preview has been pressed, so the
    // button that mattered was the one further out of reach.
    await twoDayRun(page);
    // Title is required, and without it the preview comes back as a refusal
    // rather than a plan — so Book would never appear and this would be
    // testing the wrong absence.
    await page.locator("#title").fill("Algebra practice");
    const onScreen = async () =>
      page.locator(".booking-actions").evaluate((node) => {
        const box = node.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight + 1;
      });

    expect(await onScreen()).toBe(true);
    await page.getByRole("button", { name: /Preview session/ }).click();
    await expect(page.getByRole("button", { name: /Book Session/ })).toBeVisible();
    expect(await onScreen()).toBe(true);
  });

  test("keeps the table inside the card it is drawn in", async ({ page }) => {
    // The grid is wider than any screen by design and scrolls sideways inside
    // its own box. It only does that while every ancestor is allowed to be
    // narrower than it — a `fieldset` is not, by default, and the card grew to
    // the width of the table instead.
    await twoDayRun(page);
    const overflow = await page.evaluate(() => {
      const of = (selector: string) => {
        const node = document.querySelector(selector) as HTMLElement;
        return node.scrollWidth - node.clientWidth;
      };
      return { card: of(".booking-card"), main: of(".main") };
    });
    expect(overflow.card).toBeLessThanOrEqual(1);
    expect(overflow.main).toBeLessThanOrEqual(1);
  });

  test("marks the cell a day is set to, and does not move the columns to it", async ({
    page,
  }) => {
    await twoDayRun(page);
    const table = page.locator('table[aria-labelledby="weekplan-heading"]');
    const firstHeading = table.locator("thead th:not(.daygrid-who)").first();
    await expect(firstHeading).toHaveText("12 AM");

    // Both indexes read before the click, because the locators are re-resolved
    // against the refreshed table and "the first row with a free unchosen
    // cell" will not be the same row once one of them has been pressed.
    const cell = table.locator("button.quartercell:not(.is-chosen)").first();
    const [rowIndex, column, quarter] = await cell.evaluate((node) => {
      const td = node.closest("td") as HTMLTableCellElement;
      return [
        (td.parentElement as HTMLTableRowElement).rowIndex,
        td.cellIndex,
        [...td.querySelectorAll(".quartercell")].indexOf(node),
      ];
    });
    await cell.click();
    await settled(page);

    // The pressed quarter is now the chosen one, and the axis has not moved
    // under it — the earlier grid restarted its columns at whatever was picked.
    await expect(firstHeading).toHaveText("12 AM");
    const row = table.locator("tbody tr").nth(rowIndex - 1);
    await expect(row.locator(".quartercell.is-chosen")).toHaveCount(1);
    await expect(row.locator("button.quartercell.is-chosen")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await row.locator(".quartercell.is-chosen").evaluate((node) => {
        const td = node.closest("td") as HTMLTableCellElement;
        return [td.cellIndex, [...td.querySelectorAll(".quartercell")].indexOf(node)];
      }),
    ).toEqual([column, quarter]);
  });

  test("goes back to the single-day view when the run stops repeating", async ({
    page,
  }) => {
    await twoDayRun(page);
    await expect(page.locator('table[aria-labelledby="weekplan-heading"]')).toBeVisible();

    await sessions(page, 1);
    await settled(page);
    await expect(page.locator('table[aria-labelledby="weekplan-heading"]')).toHaveCount(0);
    // The older "when, with this person" table is what a single session wants.
    await expect(page.locator('table[aria-labelledby="suggested-heading"]')).toBeVisible();
  });
});

test.describe("the Type list and the clock", () => {
  test("does not offer a delivery type nothing implements", async ({ page }) => {
    // The advanced classroom is behind a feature flag that ships off.
    await openBooking(page);
    const labels = await page.locator("#delivery_type option").allTextContents();
    expect(labels.join(" ")).not.toContain("Advanced");
    expect(labels.join(" ")).toContain("Online Classroom");
    // And it is no longer "Other", because there is nothing left to be other than.
    expect(labels.join(" ")).not.toContain("Other Online Classroom");
  });

  test("names the link field after the classroom it points at", async ({ page }) => {
    await openBooking(page);
    await expect(page.locator('label[for="meeting_url"]')).toHaveText(
      "Online Classroom link",
    );
  });

  test("sets hour, minute and meridiem in one choice", async ({ page }) => {
    // The browser's time picker closed on the first of the three. This is a
    // list, so one open and one choice settles all of it.
    await openBooking(page);
    const clock = page.locator("#start_time");
    await expect(clock).toHaveJSProperty("tagName", "SELECT");

    await clock.selectOption("13:15");
    await settled(page);
    await expect(clock).toHaveValue("13:15");
    await expect(clock.locator("option:checked")).toHaveText("1:15 PM");

    // A whole day at quarter hours, midnight to a quarter to midnight.
    await expect(clock.locator("option")).toHaveCount(96);
    await expect(clock.locator("option").first()).toHaveText("12:00 AM");
    await expect(clock.locator("option").last()).toHaveText("11:45 PM");
  });
});
