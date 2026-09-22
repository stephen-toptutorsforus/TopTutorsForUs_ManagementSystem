/**
 * Which meeting provider this process will use, if any.
 *
 * Mock is opt-in (`USE_MOCK_ZOOM=true`). Missing Zoom credentials do not
 * silently become a mock — that would be a seam made to look implemented.
 * A booking that asked for auto-create then refuses, which is the honest
 * answer.
 */

import { MockMeetingProvider } from "./mock";
import { ZoomMeetingProvider, zoomCredentialsFrom } from "./zoom";
import type { MeetingProvider } from "./types";

export function resolveMeetingProvider(
  env: Record<string, string | undefined> = process.env,
): MeetingProvider | null {
  if (env.USE_MOCK_ZOOM === "true") return new MockMeetingProvider();
  const credentials = zoomCredentialsFrom(env);
  if (credentials === null) return null;
  return new ZoomMeetingProvider(credentials);
}
