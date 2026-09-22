/**
 * One classroom meeting, created by a provider.
 *
 * `joinUrl` is what students follow and is what we store in `meeting_url`.
 * `startUrl` is the host link and lives only in `classroom_config`. Neither
 * belongs in a log, an audit event, or an error message.
 */
export interface CreatedMeeting {
  joinUrl: string;
  startUrl: string;
  meetingId: string;
  uuid?: string;
}

export interface MeetingSpec {
  topic: string;
  start: Date;
  durationMinutes: number;
}

export interface MeetingProvider {
  readonly kind: "mock" | "zoom";
  createMeeting(spec: MeetingSpec): Promise<CreatedMeeting>;
  deleteMeeting(meetingId: string): Promise<void>;
}
