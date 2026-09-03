/**
 * Session booking.
 *
 * Ported from `new_session_form` in `app/web/views.py`. The page builds the
 * first paint's context; every subsequent state — a refreshed availability
 * block, a preview, a refusal — comes back from the same action, so the two can
 * never disagree about who is free or what would be written.
 */

import { BookingForm } from "@/components/booking/BookingForm";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { MATRIX_MAX_DAYS, MATRIX_PAGE_DAYS, bookingContext } from "@/lib/web/booking";
import { csrfToken, requireContext } from "@/lib/web/session";

export const metadata = { title: "Session Booking · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, organization } = await requireContext();
  principal.require(Permission.SESSION_BOOK);

  const search = await searchParams;
  const askedDays = Number.parseInt(String(search.days ?? ""), 10);
  const matrixDays = Number.isFinite(askedDays)
    ? Math.min(MATRIX_MAX_DAYS, Math.max(MATRIX_PAGE_DAYS, askedDays))
    : MATRIX_PAGE_DAYS;

  const context = await bookingContext(prisma, principal, organization, {
    day: null,
    fromTime: "09:00",
    instructorRef: "",
    matrixDays,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Session Booking</h1>
        </div>
      </div>
      <BookingForm
        csrfToken={await csrfToken()}
        initial={{
          context,
          values: { start_time: "16:00", occurrence_count: "1" },
          selectedStudents: [],
          plan: null,
        }}
      />
    </>
  );
}
