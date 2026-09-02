/**
 * Tenant scoping for queries.
 *
 * Ported from `app/policies/scoping.py`. Every read of a tenant-owned table
 * goes through here. The reason is not convenience — it is that a missing
 * `WHERE organization_id = ...` is invisible in review, produces
 * correct-looking results in a single-tenant development database, and only
 * becomes a cross-tenant disclosure in production.
 *
 * `fetchScoped()` additionally turns "belongs to another tenant" into
 * `NotFound` rather than `Forbidden`, because a 403 confirms the record exists.
 *
 * The shape differs from the Python original because Prisma has no statement
 * object to narrow: `scoped()` returns the tenant fragment of a `where` clause,
 * to be spread into one. The property it buys is the same — the filter is
 * written once, and a call site that forgets it is visibly missing a spread
 * rather than invisibly missing a predicate.
 */

import { NotFound } from "@/lib/errors";
import type { Principal } from "@/lib/policies/principal";

export interface TenantScope {
  organizationId: bigint;
}

/** The tenant fragment of a `where` clause. Spread it into every query. */
export function scoped(principal: Principal): TenantScope {
  return { organizationId: principal.organizationId };
}

/** Anything with Prisma's `findFirst`, which is every model delegate. */
export interface ScopableDelegate<T> {
  findFirst(args: { where: Record<string, unknown> }): Promise<T | null>;
}

export interface FetchOptions {
  /** The public ref. Lookups are by ref throughout the application. */
  ref?: string;
  /** An internal id, for callers that already hold one. */
  id?: bigint;
  /** What to call the thing in the refusal. Never leaks whose it was. */
  label?: string;
  /**
   * Whether the model carries `archived_at`. True for the tables historical
   * reporting must still resolve; false for join rows that are deleted
   * outright. A wrong value fails loudly on an unknown column rather than
   * quietly widening the result.
   */
  softDelete?: boolean;
  includeArchived?: boolean;
}

/**
 * Load one record by public ref (preferred) or id, within the tenant.
 *
 * Either way the tenant filter is applied in the same statement, so there is no
 * window in which an unscoped row is loaded and checked afterwards.
 */
export async function fetchScoped<T>(
  delegate: ScopableDelegate<T>,
  principal: Principal,
  options: FetchOptions,
): Promise<T> {
  const { ref, id, label = "record", softDelete = true, includeArchived = false } = options;
  if ((ref === undefined) === (id === undefined)) {
    throw new Error("pass exactly one of ref or id");
  }

  const where: Record<string, unknown> = { ...scoped(principal) };
  if (ref !== undefined) where.ref = ref;
  else where.id = id;
  if (softDelete && !includeArchived) where.archivedAt = null;

  const found = await delegate.findFirst({ where });
  if (found === null) throw new NotFound(`no such ${label}`);
  return found;
}
