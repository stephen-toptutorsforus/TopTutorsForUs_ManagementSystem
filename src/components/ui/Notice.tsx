/**
 * A short announcement above a form.
 *
 * Never identifying: these are rendered into a live region and read aloud, so
 * a message naming a student says it to whoever is in the room.
 */

/** A short, non-identifying announcement. Lands in the page's live region. */
export function Notice({
  tone = "good",
  children,
}: {
  tone?: "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const glyph = tone === "good" ? "✓" : "!";
  return (
    <p className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <span aria-hidden="true">{glyph}</span> <span>{children}</span>
    </p>
  );
}
