/**
 * Zoom, as a MeetingProvider.
 *
 * Server-to-Server OAuth, one shared host user, one scheduled meeting per
 * occurrence — the same create body the main app uses. Credentials come in
 * through the constructor so a test can supply them without touching `process.env`,
 * and so this file never reads a secret it then has a chance to print.
 *
 * Failures become `ServiceUnavailable` with a fixed sentence. The Zoom
 * response body is dropped: it can quote a meeting URL.
 */

import { ServiceUnavailable } from "@/lib/errors";

import type { CreatedMeeting, MeetingProvider, MeetingSpec } from "./types";

const ZOOM_API = "https://api.zoom.us/v2";
const ZOOM_TOKEN = "https://zoom.us/oauth/token";

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostUser: string;
}

export interface ZoomMeetingProviderOptions extends ZoomCredentials {
  fetch?: typeof fetch;
}

export function zoomCredentialsFrom(
  env: Record<string, string | undefined>,
): ZoomCredentials | null {
  const accountId = env.ZOOM_ACCOUNT_ID?.trim() ?? "";
  const clientId = env.ZOOM_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.ZOOM_CLIENT_SECRET?.trim() ?? "";
  const hostUser =
    env.ZOOM_HOST_USER_ID?.trim() ||
    env.ZOOM_USER_ID?.trim() ||
    env.ZOOM_HOST_EMAIL?.trim() ||
    env.ZOOM_USER_EMAIL?.trim() ||
    "";
  if (!accountId || !clientId || !clientSecret || !hostUser) return null;
  return { accountId, clientId, clientSecret, hostUser };
}

export class ZoomMeetingProvider implements MeetingProvider {
  readonly kind = "zoom" as const;
  private readonly credentials: ZoomCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ZoomMeetingProviderOptions) {
    this.credentials = {
      accountId: options.accountId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      hostUser: options.hostUser,
    };
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createMeeting(spec: MeetingSpec): Promise<CreatedMeeting> {
    const token = await this.accessToken();
    const startTime = spec.start.toISOString().replace(/\.\d{3}Z$/, "Z");
    const topic = spec.topic
      .replace(/[—–]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .slice(0, 200);

    const response = await this.fetchImpl(
      `${ZOOM_API}/users/${encodeURIComponent(this.credentials.hostUser)}/meetings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic,
          type: 2,
          start_time: startTime,
          duration: spec.durationMinutes,
          settings: {
            join_before_host: true,
            waiting_room: false,
            mute_upon_entry: true,
            auto_recording: "none",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailable("Zoom meeting could not be created");
    }

    const data = (await response.json()) as {
      id?: number | string;
      uuid?: string;
      join_url?: string;
      start_url?: string;
    };
    if (!data.id || !data.join_url || !data.start_url) {
      throw new ServiceUnavailable("Zoom meeting could not be created");
    }

    return {
      meetingId: String(data.id),
      uuid: typeof data.uuid === "string" ? data.uuid : undefined,
      joinUrl: data.join_url,
      startUrl: data.start_url,
    };
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(
      `${ZOOM_API}/meetings/${encodeURIComponent(meetingId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (response.ok || response.status === 404) return;
    throw new ServiceUnavailable("Zoom meeting could not be cancelled");
  }

  private async accessToken(): Promise<string> {
    const { accountId, clientId, clientSecret } = this.credentials;
    const response = await this.fetchImpl(
      `${ZOOM_TOKEN}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailable("Zoom meeting could not be created");
    }
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new ServiceUnavailable("Zoom meeting could not be created");
    }
    return data.access_token;
  }
}
