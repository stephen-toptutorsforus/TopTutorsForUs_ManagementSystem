/**
 * Times, always with the zone they were meant in.
 *
 * A tutoring operation spans zones, so a bare "16:00" is ambiguous in a way
 * that quietly puts people in the wrong room. Every time printed here carries
 * its zone label for the reader and a machine-readable `dateTime` for anything
 * else reading the page.
 */

import { Moment } from "@/lib/rendering";

/**
 * A time is never printed without its zone, and always carries a
 * machine-readable `dateTime` for assistive technology.
 */
export function When({ instant, zone }: { instant: Date | null; zone: string }) {
  if (!instant) return <>—</>;
  const moment = new Moment(instant, zone);
  return <time dateTime={moment.iso}>{moment.full}</time>;
}

export function WhenTime({ instant, zone }: { instant: Date | null; zone: string }) {
  if (!instant) return <>—</>;
  const moment = new Moment(instant, zone);
  return (
    <time dateTime={moment.iso}>
      {moment.time} {moment.zoneLabel}
    </time>
  );
}
