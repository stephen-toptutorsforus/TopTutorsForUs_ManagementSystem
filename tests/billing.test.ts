/**
 * What disappears when a tenant charges for nothing.
 *
 * This product runs every session free, so `booking.billable_enabled` ships
 * `false` and the Billable box, the Billable, Payment and Invoice columns and
 * the API's `billable` field are all drawn from that one answer. The rule was
 * spelled out in nine places before it was a function, which is the shape of
 * bug this file exists to catch: a screen that hides a control while a handler
 * still honours it is not a hidden control, it is a hidden field.
 *
 * The write side — that `createFromPlan` books a free session whatever the
 * request says, and that `editDetails` ignores `billable` — needs a database
 * and lives in `tests/db/booking.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { DeliveryType, SessionStatus } from "@/generated/prisma/enums";
import {
  DEFAULT_SETTINGS,
  billingEnabled,
  type ConfigurableOrganization,
} from "@/lib/organization";
import {
  AVAILABLE_COLUMNS,
  DEFAULT_COLUMNS,
  MONEY_COLUMNS,
  columnsFor,
  type SessionRow,
} from "@/lib/services/sessionQuery";
import { toSessionOut } from "@/lib/web/api";

const NY = "America/New_York";

/** A tenant whose settings say exactly one thing, or nothing at all. */
const org = (billing?: boolean): ConfigurableOrganization => ({
  settings: billing === undefined ? {} : { booking: { billable_enabled: billing } },
});

/**
 * A row carrying the fields the serialiser reads and no others — cast for the
 * same reason `tests/sessionPeek.test.ts` casts: the model has some forty
 * columns and listing them would bury the two this is about.
 */
const aRow = (): SessionRow => {
  const start = new Date("2026-04-07T13:00:00Z");
  return {
    session: {
      ref: "ses_test",
      title: "Algebra",
      status: SessionStatus.SCHEDULED,
      deliveryType: DeliveryType.EXTERNAL_LINK,
      billable: true,
      timezone: NY,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 3_600_000),
      actualStart: null,
      actualEnd: null,
      seriesIndex: null,
      detachedFromSeries: false,
    },
    instructorName: "Rowan Mercer",
    studentNames: ["Teo Vasquez"],
    studentCount: 1,
    attendanceRate: null,
  } as unknown as SessionRow;
};

describe("whether money is part of a tenant's vocabulary", () => {
  it("is off for a tenant that has configured nothing", () => {
    // The whole point: no migration, no settings screen, nothing to switch on.
    // A deployment that does nothing at all charges for nothing at all.
    expect(billingEnabled(null)).toBe(false);
    expect(billingEnabled(undefined)).toBe(false);
    expect(billingEnabled(org())).toBe(false);
  });

  it("is what the tenant stored, either way", () => {
    expect(billingEnabled(org(true))).toBe(true);
    // Stored `false` must not read as "unset" and fall through to a shipped
    // `true` — the mistake `booking.instructor_eligibility_mode` is deliberately
    // absent from the defaults to avoid.
    expect(billingEnabled(org(false))).toBe(false);
  });

  it("ships off in the defaults, which is where the answer actually comes from", () => {
    const booking = (DEFAULT_SETTINGS as { booking: Record<string, unknown> }).booking;
    expect(booking.billable_enabled).toBe(false);
    // Still `true`, and still meaningful: it is what the box starts as for a
    // tenant that turns billing on and configures nothing else.
    expect(booking.billable_default).toBe(true);
  });
});

describe("which columns the session grid may offer", () => {
  it("drops the three money columns for a tenant that charges for nothing", () => {
    const offered = columnsFor(org());
    expect(Object.keys(offered)).not.toContain("billable");
    expect(Object.keys(offered)).not.toContain("payment");
    expect(Object.keys(offered)).not.toContain("invoice");
    // And nothing else moved.
    expect(Object.keys(offered)).toEqual(
      Object.keys(AVAILABLE_COLUMNS).filter((key) => !MONEY_COLUMNS.includes(key)),
    );
  });

  it("offers the whole catalogue to a tenant that charges", () => {
    expect(columnsFor(org(true))).toBe(AVAILABLE_COLUMNS);
  });

  it("keeps the money columns in the catalogue even when they are not offered", () => {
    // `parseFilters` validates against `AVAILABLE_COLUMNS`, and a key removed
    // from there would make a stored `columns=billable,title` fall back to the
    // defaults — losing the rest of somebody's choice rather than one column
    // of it.
    for (const key of MONEY_COLUMNS) expect(AVAILABLE_COLUMNS).toHaveProperty(key);
  });

  it("never narrows the columns the grid starts with", () => {
    // If a money column were ever added to the defaults, every tenant with
    // billing off would open the grid on a view that immediately differs from
    // `DEFAULT_COLUMNS` — and `toQuery` would start writing a column list into
    // the cookie for a filter nobody had touched.
    for (const key of DEFAULT_COLUMNS) expect(MONEY_COLUMNS).not.toContain(key);
  });
});

describe("what the JSON API says about it", () => {
  it("leaves the field out entirely for a tenant that charges for nothing", () => {
    const out = toSessionOut(aRow(), { organization: org() });
    expect("billable" in out).toBe(false);
    // Omitted rather than sent as a constant `false`: a field that is always
    // one value is one a client eventually builds a column out of.
    expect(JSON.stringify(out)).not.toContain("billable");
  });

  it("sends it for a tenant that charges", () => {
    expect(toSessionOut(aRow(), { organization: org(true) }).billable).toBe(true);
  });

  it("leaves it out when nobody said which tenant", () => {
    // The default is the shipped default, not "assume the widest answer".
    expect("billable" in toSessionOut(aRow())).toBe(false);
  });
});
