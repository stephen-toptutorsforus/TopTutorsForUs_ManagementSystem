/**
 * Differential check of `resolveCivil` against the Python implementation.
 *
 * Unit tests pin the cases somebody thought of. This replays a dense grid —
 * every day of a year, several times of day, across zones chosen for awkward
 * rules — and reports any input where the two disagree on the instant or on
 * which DST edge was hit.
 */
import { readFileSync } from "node:fs";

import { resolveCivil } from "../src/lib/time.ts";

type Case = [day: string, time: string, zone: string, instant: string, edge: string];

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx tools/parity-time.mts <oracle.json>");
  process.exit(2);
}

const cases: Case[] = JSON.parse(readFileSync(path, "utf-8"));
const byZone = new Map<string, number>();
const samples: string[] = [];
let mismatches = 0;

for (const [day, time, zone, wantInstant, wantEdge] of cases) {
  const got = resolveCivil(day, time, zone);
  const gotInstant = got.instant.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  if (gotInstant !== wantInstant || got.edge !== wantEdge) {
    mismatches += 1;
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    if (samples.length < 8) {
      samples.push(
        `  ${day} ${time} ${zone}\n    python: ${wantInstant} ${wantEdge}\n    ts    : ${gotInstant} ${got.edge}`,
      );
    }
  }
}

const edges = new Map<string, number>();
for (const [, , , , edge] of cases) edges.set(edge, (edges.get(edge) ?? 0) + 1);

console.log(`${cases.length} cases, ${mismatches} mismatches`);
console.log("edges in the grid:", Object.fromEntries(edges));
if (mismatches) {
  console.log([...byZone].map(([z, n]) => `  ${z}: ${n}`).join("\n"));
  console.log(samples.join("\n"));
  process.exit(1);
}
