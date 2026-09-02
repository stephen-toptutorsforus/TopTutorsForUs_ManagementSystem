/**
 * Differential check of `expand` against the Python implementation.
 *
 * Every rule in the reference file is replayed and the whole result compared:
 * the dates, the instants, the end times, the 1-based indexes, the DST edge on
 * each occurrence, whether the run was truncated and why, and which closures it
 * skipped. A difference anywhere in that is a difference in the product.
 */
import { readFileSync } from "node:fs";

import { buildRule, expand } from "../src/lib/recurrence.ts";

interface Case {
  input: {
    frequency: "daily" | "weekly";
    intervalN: number;
    weekdays: string[] | null;
    startDate: string;
    startTime: string;
    durationMinutes: number;
    timezone: string;
    endMode: "count" | "until";
    occurrenceCount: number | null;
    untilDate: string | null;
    skip: string[];
    maxOccurrences: number;
    maxHorizonDays: number;
  } | null;
  out: {
    dates: string[];
    starts: string[];
    ends: string[];
    indexes: number[];
    edges: string[];
    truncated: boolean;
    reason: string | null;
    skipped: string[];
  };
}

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx tools/parity-recurrence.mts <oracle.json>");
  process.exit(2);
}

const cases: Case[] = JSON.parse(readFileSync(path, "utf-8"));
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");

const samples: string[] = [];
const byField = new Map<string, number>();
let checked = 0;
let occurrences = 0;
let mismatches = 0;

for (const { input, out } of cases) {
  if (!input) continue;
  checked += 1;

  const rule = buildRule({
    frequency: input.frequency,
    intervalN: input.intervalN,
    weekdays: input.weekdays,
    startDate: input.startDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
    endMode: input.endMode,
    occurrenceCount: input.occurrenceCount,
    untilDate: input.untilDate,
  });
  const got = expand(rule, {
    maxOccurrences: input.maxOccurrences,
    maxHorizonDays: input.maxHorizonDays,
    skipDates: input.skip,
  });
  occurrences += got.occurrences.length;

  const mine = {
    dates: got.occurrences.map((o) => o.localDate),
    starts: got.occurrences.map((o) => iso(o.start)),
    ends: got.occurrences.map((o) => iso(o.end)),
    indexes: got.occurrences.map((o) => o.index),
    edges: got.occurrences.map((o) => String(o.dstEdge)),
    truncated: got.truncated,
    reason: got.truncationReason,
    skipped: got.skippedDates,
  };

  const differing = (Object.keys(mine) as (keyof typeof mine)[]).filter(
    (field) => JSON.stringify(mine[field]) !== JSON.stringify(out[field]),
  );
  if (differing.length > 0) {
    mismatches += 1;
    for (const field of differing) byField.set(field, (byField.get(field) ?? 0) + 1);
    if (samples.length < 5) {
      samples.push(
        `  ${JSON.stringify(input)}\n` +
          differing
            .map(
              (f) =>
                `    ${f}\n      python: ${JSON.stringify(out[f])}\n      ts    : ${JSON.stringify(mine[f])}`,
            )
            .join("\n"),
      );
    }
  }
}

console.log(`${checked} rules, ${occurrences} occurrences, ${mismatches} mismatching rules`);
if (mismatches) {
  console.log("fields that differ:", Object.fromEntries(byField));
  console.log(samples.join("\n"));
  process.exit(1);
}
