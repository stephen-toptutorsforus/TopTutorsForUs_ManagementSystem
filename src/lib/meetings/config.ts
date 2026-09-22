/**
 * Read and write the occurrence's `classroom_config` for a created meeting.
 *
 * Join URLs stay in `meeting_url`. This object is the host start URL and the
 * provider's meeting id — enough to start the room, and later to cancel it.
 */

import type { CreatedMeeting } from "./types";

export interface ClassroomMeeting {
  provider: string;
  meetingId: string;
  meetingUuid?: string;
  startUrl: string;
}

export function classroomConfigFor(
  created: CreatedMeeting,
  provider: string,
): ClassroomMeeting {
  return {
    provider,
    meetingId: created.meetingId,
    ...(created.uuid ? { meetingUuid: created.uuid } : {}),
    startUrl: created.startUrl,
  };
}

export function meetingFromConfig(config: unknown): ClassroomMeeting | null {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  const row = config as Record<string, unknown>;
  if (typeof row.provider !== "string" || row.provider === "") return null;
  if (typeof row.meetingId !== "string" || row.meetingId === "") return null;
  if (typeof row.startUrl !== "string" || row.startUrl === "") return null;
  return {
    provider: row.provider,
    meetingId: row.meetingId,
    meetingUuid: typeof row.meetingUuid === "string" ? row.meetingUuid : undefined,
    startUrl: row.startUrl,
  };
}
