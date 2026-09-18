"use server";

/**
 * The import screen's two steps.
 *
 * The first upload previews and writes nothing; the second confirms a batch by
 * its ref and writes what it can. Both are ordinary server actions following
 * the contract every other form here follows — `verifyCsrf`, then
 * `requireContext`, then a service that checks the permission itself.
 *
 * This file exports nothing but async functions, which is not a style choice:
 * a `"use server"` module that exports a type or a constant is unloadable. The
 * result shape lives in `@/lib/web/importReport`.
 */

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { ValidationError, payloadFor } from "@/lib/errors";
import { commitImport, previewImport } from "@/lib/services/import";
import type { ImportFiles } from "@/lib/services/import";
import type { ImportFormState } from "@/lib/web/importReport";
import { requireContext, verifyCsrf } from "@/lib/web/session";

/**
 * The largest file this screen will read.
 *
 * Next's own server-action body limit is raised in `next.config.ts` to a little
 * over this, so an oversized upload is refused here with a sentence somebody
 * can act on rather than by the framework with one they cannot.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/** One uploaded file, as text — or nothing, for a field left empty. */
async function textOf(value: FormDataEntryValue | null, label: string): Promise<string | null> {
  if (value === null || typeof value === "string") return null;
  const file = value;
  if (file.size === 0) return null;
  if (file.size > MAX_BYTES) {
    throw new ValidationError(
      `the ${label} file is larger than ${Math.floor(MAX_BYTES / 1024 / 1024)}MB`,
    );
  }
  return file.text();
}

async function filesFrom(form: FormData): Promise<ImportFiles> {
  const people = await textOf(form.get("people"), "people");
  const sessions = await textOf(form.get("sessions"), "sessions");
  const series = await textOf(form.get("series"), "series");
  return {
    ...(people !== null ? { people } : {}),
    ...(sessions !== null ? { sessions } : {}),
    ...(series !== null ? { series } : {}),
  };
}

export async function previewImportAction(
  _previous: ImportFormState,
  form: FormData,
): Promise<ImportFormState> {
  try {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();
    const report = await previewImport(prisma, organization, principal, await filesFrom(form));
    return { report };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}

export async function commitImportAction(
  _previous: ImportFormState,
  form: FormData,
): Promise<ImportFormState> {
  try {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();
    const report = await commitImport(
      prisma,
      organization,
      principal,
      String(form.get("batch") ?? ""),
    );
    // Everything an import can touch. Not `/import` — nothing on this screen
    // reads the rows it wrote, and every screen that does is now stale.
    for (const path of ["/people", "/sessions", "/series", "/calendar", "/audit", "/"]) {
      revalidatePath(path);
    }
    return { report };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}
