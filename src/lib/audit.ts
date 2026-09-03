/**
 * Writing the audit trail.
 *
 * Ported from `app/services/audit.py`.
 *
 * **Redaction is an allowlist, not a denylist.** `record()` only ever stores
 * fields named in `AUDITABLE_FIELDS`; anything else is dropped, and a value
 * that is not a scalar is replaced by a marker rather than serialised. A
 * denylist relies on every future call site remembering to exclude the
 * sensitive field, and one that forgets turns the audit log into an
 * unprotected copy of the data it exists to protect. An allowlist fails the
 * other way: a new field is invisible until someone deliberately adds it.
 *
 * **Events are written in the same transaction as the change they record.**
 * They take the caller's transaction client and are written through it.
 * History that can be committed separately from its mutation is not history —
 * it is a second, occasionally truthful log.
 *
 * The stored keys are the snake_case domain names the Python service uses, not
 * the camelCase Prisma property names, so a row written by either service reads
 * the same. Timestamps inside `changes` are ISO-8601 with a `Z` suffix where
 * the Python writes `+00:00`; the instant is identical and the field is for
 * display, but the two are not byte-comparable.
 */

import type { Prisma } from "@/generated/prisma/client";
import type { AuditCategory } from "@/generated/prisma/enums";
import type { Principal } from "@/lib/policies/principal";

/**
 * The complete set of fields whose before/after values may be stored.
 * Scheduling and state facts only. Names, addresses, phone numbers, note
 * bodies, message text, and meeting URLs are absent by design and must stay
 * absent.
 */
export const AUDITABLE_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "scheduled_start",
  "scheduled_end",
  "actual_start",
  "actual_end",
  "timezone",
  "delivery_type",
  "duration_minutes",
  "billable",
  "instructor_ref",
  "location_ref",
  "program_ref",
  "subject_ref",
  "grade_ref",
  "group_ref",
  "series_ref",
  "series_index",
  "detached_from_series",
  "title",
  "attendance",
  "joined_at",
  "left_at",
  "attended_minutes",
  "participant_ref",
  "participant_role",
  "cancellation_reason",
  "missed_reason",
  "conflict_overridden",
  "occurrence_count",
  "weekdays",
  "start_time",
  "frequency",
  "interval_n",
  "role",
  "permission",
  "user_status",
]);

/**
 * Fields whose value is a person's own words. Recorded as present/absent only,
 * so the trail can show that a reason was given without republishing it.
 */
export const PRESENCE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "cancellation_note",
  "reschedule_reason",
]);

const REDACTED = "«redacted»";
const PRESENT = "«provided»";

export type Scalar = string | number | boolean | null | string[];
export type Snapshot = Record<string, unknown>;
export type Changes = Record<string, { from: Scalar; to: Scalar }>;

/** Reduce a value to something safe and comparable, or mark it redacted. */
function scalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  // Defensive: no auditable field carries an id, and none should start to.
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return REDACTED;
}

/**
 * Field-level diffs for the allowed fields, and only where a value changed.
 *
 * Recording unchanged fields would make every edit look like a rewrite and
 * bury the one field that actually moved.
 */
export function buildChanges(before: Snapshot, after: Snapshot): Changes {
  const changes: Changes = {};
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (PRESENCE_ONLY_FIELDS.has(field)) {
      const was = Boolean(before[field]);
      const now = Boolean(after[field]);
      if (was !== now) {
        changes[field] = { from: was ? PRESENT : null, to: now ? PRESENT : null };
      }
      continue;
    }
    if (!AUDITABLE_FIELDS.has(field)) continue;

    const old = scalar(before[field]);
    const now = scalar(after[field]);
    if (!sameScalar(old, now)) changes[field] = { from: old, to: now };
  }
  return changes;
}

/** Arrays are the one non-primitive a scalar can be, so identity is not enough. */
function sameScalar(a: Scalar, b: Scalar): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** Anything that can write. A transaction client satisfies it, which is the point. */
export type AuditWriter = {
  auditEvent: {
    create(args: { data: Prisma.AuditEventUncheckedCreateInput }): Promise<{ id: bigint }>;
  };
};

export interface RecordOptions {
  category: AuditCategory;
  /** A verb phrase in the domain's own words, e.g. "session.rescheduled". */
  action: string;
  entityType: string;
  entityId: bigint;
  entityRef?: string | null;
  before?: Snapshot;
  after?: Snapshot;
  /** A pre-built diff, for callers that did not snapshot a row. */
  changes?: Changes;
  /** A short, non-identifying explanation, e.g. "conflict override". */
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  ref?: string;
  occurredAt?: Date;
}

/**
 * Append one event.
 *
 * Takes the writer rather than reaching for the global client, so a caller
 * inside `$transaction` passes its transaction client and the event lands or
 * rolls back with the change it records.
 */
export async function record(
  writer: AuditWriter,
  principal: Principal,
  options: RecordOptions,
): Promise<{ id: bigint }> {
  const changes =
    options.changes ?? buildChanges(options.before ?? {}, options.after ?? {});

  return writer.auditEvent.create({
    data: {
      ref: options.ref ?? newAuditRef(),
      organizationId: principal.organizationId,
      category: options.category,
      action: options.action,
      entityType: options.entityType,
      entityId: options.entityId,
      entityRef: options.entityRef ?? null,
      actorId: principal.userId,
      actorRole: principal.primaryRole.toLowerCase(),
      // Copied so the trail still reads correctly once the actor's roles change
      // or their account is archived.
      actorLabel: principal.displayName,
      changes: changes as Prisma.InputJsonValue,
      note: options.note ? options.note.slice(0, 240) : null,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ? options.userAgent.slice(0, 240) : null,
      occurredAt: options.occurredAt ?? new Date(),
    },
  });
}

const REF_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alike characters

function newAuditRef(): string {
  let body = "";
  for (let index = 0; index < 10; index += 1) {
    body += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `aud_${body}`;
}

/** `scheduledStart` is stored as `scheduled_start`, matching the Python service. */
function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Read the named attributes off a row, for a before/after pair.
 *
 * Fields are named as they are on the Prisma row; the keys in the snapshot are
 * the snake_case forms, which is what the allowlist and the stored JSON use.
 */
export function snapshot(row: Record<string, unknown>, fields: readonly string[]): Snapshot {
  const captured: Snapshot = {};
  for (const field of fields) captured[snakeCase(field)] = row[field] ?? null;
  return captured;
}

/** The fields captured either side of a session change. */
export const SESSION_FIELDS: readonly string[] = [
  "title",
  "status",
  "scheduledStart",
  "scheduledEnd",
  "actualStart",
  "actualEnd",
  "timezone",
  "deliveryType",
  "billable",
  "seriesIndex",
  "detachedFromSeries",
  "cancellationReason",
  "missedReason",
  "conflictOverridden",
];
