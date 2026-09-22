/**
 * Meeting providers: mock, Zoom request shape, and how the process picks one.
 *
 * Zoom is never called. The adapter is given a fake `fetch`, and resolve
 * reads only the env object it is passed. URLs in these cases are on
 * `.example.test`.
 */

import { describe, expect, it } from "vitest";

import { ServiceUnavailable } from "@/lib/errors";
import { classroomConfigFor, meetingFromConfig } from "@/lib/meetings/config";
import { MockMeetingProvider } from "@/lib/meetings/mock";
import { resolveMeetingProvider } from "@/lib/meetings/resolve";
import { ZoomMeetingProvider } from "@/lib/meetings/zoom";

const START = new Date("2026-04-06T20:00:00.123Z");

describe("the mock provider", () => {
  it("hands back a reserved-domain join URL per create", async () => {
    const provider = new MockMeetingProvider();
    const first = await provider.createMeeting({
      topic: "Algebra",
      start: START,
      durationMinutes: 60,
    });
    const second = await provider.createMeeting({
      topic: "Algebra",
      start: START,
      durationMinutes: 60,
    });

    expect(first.joinUrl).toBe("https://meet.example.test/zoom/1");
    expect(second.joinUrl).toBe("https://meet.example.test/zoom/2");
    expect(first.joinUrl).not.toBe(second.joinUrl);
    expect(provider.kind).toBe("mock");
  });
});

describe("classroom_config", () => {
  it("stores the host start URL, not the join URL", () => {
    const config = classroomConfigFor(
      {
        joinUrl: "https://meet.example.test/zoom/1",
        startUrl: "https://meet.example.test/zoom/1/host",
        meetingId: "mock-1",
        uuid: "mock-uuid-1",
      },
      "mock",
    );

    expect(config.startUrl).toBe("https://meet.example.test/zoom/1/host");
    expect(config).not.toHaveProperty("joinUrl");
    expect(meetingFromConfig(config)?.meetingId).toBe("mock-1");
    expect(meetingFromConfig({})).toBeNull();
  });
});

describe("which provider this process uses", () => {
  it("uses the mock only when asked", () => {
    expect(resolveMeetingProvider({})).toBeNull();
    expect(resolveMeetingProvider({ USE_MOCK_ZOOM: "true" })?.kind).toBe("mock");
  });

  it("uses Zoom when every credential is present and mock is off", () => {
    const provider = resolveMeetingProvider({
      ZOOM_ACCOUNT_ID: "acc",
      ZOOM_CLIENT_ID: "id",
      ZOOM_CLIENT_SECRET: "secret",
      ZOOM_HOST_EMAIL: "host@example.test",
    });
    expect(provider?.kind).toBe("zoom");
  });

  it("does not treat a partial Zoom config as enough", () => {
    expect(
      resolveMeetingProvider({
        ZOOM_ACCOUNT_ID: "acc",
        ZOOM_CLIENT_ID: "id",
      }),
    ).toBeNull();
  });
});

describe("the Zoom adapter", () => {
  it("asks for a scheduled meeting and never puts milliseconds on the start", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const raw = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, body: raw ? JSON.parse(raw) : undefined });
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: 99,
          uuid: "u",
          join_url: "https://meet.example.test/j",
          start_url: "https://meet.example.test/s",
        }),
        { status: 201 },
      );
    };

    const provider = new ZoomMeetingProvider({
      accountId: "acc",
      clientId: "id",
      clientSecret: "secret",
      hostUser: "host@example.test",
      fetch: fakeFetch,
    });
    const created = await provider.createMeeting({
      topic: "Algebra",
      start: START,
      durationMinutes: 60,
    });

    const create = calls.find((call) => call.url.includes("/meetings"));
    expect(create?.body).toMatchObject({
      topic: "Algebra",
      type: 2,
      start_time: "2026-04-06T20:00:00Z",
      duration: 60,
      settings: {
        join_before_host: true,
        waiting_room: false,
        mute_upon_entry: true,
        auto_recording: "none",
      },
    });
    expect(created.meetingId).toBe("99");
    expect(created.joinUrl).toBe("https://meet.example.test/j");
  });

  it("refuses with a sentence that names no URL when Zoom fails", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input).includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response("join_url=https://secret.example/j", { status: 500 });
    };
    const provider = new ZoomMeetingProvider({
      accountId: "acc",
      clientId: "id",
      clientSecret: "secret",
      hostUser: "host@example.test",
      fetch: fakeFetch,
    });

    await expect(
      provider.createMeeting({ topic: "Algebra", start: START, durationMinutes: 60 }),
    ).rejects.toBeInstanceOf(ServiceUnavailable);
    await expect(
      provider.createMeeting({ topic: "Algebra", start: START, durationMinutes: 60 }),
    ).rejects.toThrow("Zoom meeting could not be created");
  });
});
