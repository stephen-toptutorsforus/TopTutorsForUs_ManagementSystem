/**
 * A meeting provider that never leaves the process.
 *
 * Used when `USE_MOCK_ZOOM=true`, and injected by tests. URLs are on the
 * reserved `.test` domain so they cannot be followed by accident and cannot
 * receive anything. The kind is `mock` rather than `zoom`, so a row written
 * here cannot be mistaken for one Zoom created.
 */

import type { CreatedMeeting, MeetingProvider, MeetingSpec } from "./types";

export class MockMeetingProvider implements MeetingProvider {
  readonly kind = "mock" as const;
  readonly created: CreatedMeeting[] = [];
  readonly specs: MeetingSpec[] = [];
  readonly deleted: string[] = [];
  /** Fail the create after this many successes. Undefined means never. */
  failAfter?: number;

  async createMeeting(spec: MeetingSpec): Promise<CreatedMeeting> {
    this.specs.push(spec);
    if (this.failAfter !== undefined && this.created.length >= this.failAfter) {
      throw new Error("mock meeting provider refused the create");
    }
    const n = this.created.length + 1;
    const meeting: CreatedMeeting = {
      joinUrl: `https://meet.example.test/zoom/${n}`,
      startUrl: `https://meet.example.test/zoom/${n}/host`,
      meetingId: `mock-${n}`,
      uuid: `mock-uuid-${n}`,
    };
    this.created.push(meeting);
    return meeting;
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    this.deleted.push(meetingId);
  }
}
