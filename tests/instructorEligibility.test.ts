/**
 * Which eligibility rule a tenant is under.
 *
 * The database-backed cases live in `tests/db/instructorEligibility.test.ts`;
 * this file is only about reading the setting, which is the part that has to
 * hold for tenant rows written before the setting existed. Getting it wrong in
 * the safe direction shows an instructor a name they may not book; getting it
 * wrong in the other silently stops working bookings.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/organization";
import {
  ELIGIBILITY_MODE_PATH,
  EligibilityMode,
  eligibilityMode,
} from "@/lib/services/instructorEligibility";

const org = (settings: Record<string, unknown>) => ({ settings });

describe("eligibility mode", () => {
  it("reads each mode the tenant can name", () => {
    for (const mode of Object.values(EligibilityMode)) {
      expect(
        eligibilityMode(org({ booking: { instructor_eligibility_mode: mode } })),
      ).toBe(mode);
    }
  });

  it("is not a shipped default, so its absence can still be detected", () => {
    // The whole back-compatibility path below depends on this. `setting()`
    // walks DEFAULT_SETTINGS when a tenant has not stored a value, so a key
    // present there could never read as unset — and "unset" is exactly what
    // has to be translated from the older boolean.
    const booking = DEFAULT_SETTINGS.booking as Record<string, unknown>;
    expect(booking).not.toHaveProperty(ELIGIBILITY_MODE_PATH[1]);
  });

  it("translates the older assigned_users_only boolean when the mode is unset", () => {
    expect(eligibilityMode(org({ booking: { assigned_users_only: true } }))).toBe(
      EligibilityMode.ASSIGNED_ONLY,
    );
    expect(eligibilityMode(org({ booking: { assigned_users_only: false } }))).toBe(
      EligibilityMode.ANY_INSTRUCTOR,
    );
  });

  it("prefers the mode over the boolean when a tenant has set both", () => {
    expect(
      eligibilityMode(
        org({
          booking: {
            assigned_users_only: true,
            instructor_eligibility_mode: EligibilityMode.ANY_INSTRUCTOR,
          },
        }),
      ),
    ).toBe(EligibilityMode.ANY_INSTRUCTOR);
  });

  it("follows the shipped default for a tenant that has configured neither", () => {
    // The shipped `assigned_users_only` is true, so an unconfigured tenant is
    // under assigned_only. That is a real change in what the booking screen
    // offers once a student is chosen, and it is the behaviour the setting has
    // always described.
    expect((DEFAULT_SETTINGS.booking as Record<string, unknown>).assigned_users_only).toBe(
      true,
    );
    expect(eligibilityMode(org({}))).toBe(EligibilityMode.ASSIGNED_ONLY);
    expect(eligibilityMode(null)).toBe(EligibilityMode.ASSIGNED_ONLY);
  });

  it("falls back to the strictest mode when the stored value is not one it knows", () => {
    // A typo, or a mode from a later build. Refusing is recoverable; widening
    // the list would quietly hand out bookings the tenant did not agree to.
    expect(
      eligibilityMode(org({ booking: { instructor_eligibility_mode: "everyone_please" } })),
    ).toBe(EligibilityMode.ASSIGNED_ONLY);
  });
});
