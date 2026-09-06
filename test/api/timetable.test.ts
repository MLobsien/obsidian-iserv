import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  timetable,
  substitutions,
  substitutionBoardMessages,
} from "../../src/api/timetable";
import type { IServClient } from "../../src/api/timetable";

describe("timetable", () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
  });

  function makeClient(): IServClient {
    return { request: mockRequest } as IServClient;
  }

  it("returns parsed timetable entries on success", async () => {
    const entries = [
      {
        id: 1,
        courseSubject: {
          teachers: [{ displayname: "Müller", externalId: "t1" }],
          subject: { name: "Mathematik", acronym: "MATH", hexColor: "#ff0000" },
          course: { id: 10, name: "12gN" },
        },
        weekday: 1,
        timeTableSlot: 3,
        room: "B204",
      },
    ];
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify(entries),
      json: entries,
    });

    const client = makeClient();
    const result = await timetable(client);

    expect(result).toEqual(entries);
    expect(mockRequest).toHaveBeenCalledWith(
      "/iserv/dieschulapp/api/1.0/timetable-entries/"
    );
  });

  it("returns empty array on non-200 status", async () => {
    mockRequest.mockResolvedValue({
      status: 401,
      headers: {},
      body: "Unauthorized",
    });

    const client = makeClient();
    const result = await timetable(client);

    expect(result).toEqual([]);
  });

  it("returns empty array when response.json is not an array", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: '{"error":"bad"}',
      json: { error: "bad" },
    });

    const client = makeClient();
    const result = await timetable(client);

    expect(result).toEqual([]);
  });

  it("returns empty array on request error", async () => {
    mockRequest.mockRejectedValue(new Error("Network error"));

    const client = makeClient();
    const result = await timetable(client);

    expect(result).toEqual([]);
  });
});

describe("substitutions", () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
  });

  function makeClient(): IServClient {
    return { request: mockRequest } as IServClient;
  }

  it("returns parsed substitutions on success", async () => {
    const subs = [
      {
        id: 42,
        createdAt: "2026-09-05T08:00:00Z",
        channel: { name: "12gN", type: "course" },
        channels: [{ name: "12gN", type: "course" }],
        date: "2026-09-05",
        substitutionType: "class-absence",
        displayMessageForStudents: "Entfall",
        room: "B204",
        insteadOfTeacher: "",
        hour: 3,
      },
    ];
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify(subs),
      json: subs,
    });

    const client = makeClient();
    const result = await substitutions(client);

    expect(result).toEqual(subs);
    expect(result[0].substitutionType).toBe("class-absence");
    expect(mockRequest).toHaveBeenCalledWith(
      "/iserv/dieschulapp/api/1.0/substitutions/"
    );
  });

  it("returns empty array on non-200 status", async () => {
    mockRequest.mockResolvedValue({
      status: 500,
      headers: {},
      body: "Server Error",
    });

    const client = makeClient();
    const result = await substitutions(client);

    expect(result).toEqual([]);
  });

  it("returns empty array when json is not an array", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: '"not-array"',
      json: "not-array",
    });

    const client = makeClient();
    const result = await substitutions(client);

    expect(result).toEqual([]);
  });

  it("returns empty array on network failure", async () => {
    mockRequest.mockRejectedValue(new Error("Connection refused"));

    const client = makeClient();
    const result = await substitutions(client);

    expect(result).toEqual([]);
  });
});

describe("substitutionBoardMessages", () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
  });

  function makeClient(): IServClient {
    return { request: mockRequest } as IServClient;
  }

  it("returns parsed board messages on success", async () => {
    const messages = [{ id: 1, message: "Test message" }];
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify(messages),
      json: messages,
    });

    const client = makeClient();
    const result = await substitutionBoardMessages(client);

    expect(result).toEqual(messages);
    expect(mockRequest).toHaveBeenCalledWith(
      "/iserv/dieschulapp/api/1.0/substitutionBoardMessages/"
    );
  });

  it("returns empty array on non-200 status", async () => {
    mockRequest.mockResolvedValue({
      status: 404,
      headers: {},
      body: "Not Found",
    });

    const client = makeClient();
    const result = await substitutionBoardMessages(client);

    expect(result).toEqual([]);
  });

  it("returns empty array when json is an empty array", async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: "[]",
      json: [],
    });

    const client = makeClient();
    const result = await substitutionBoardMessages(client);

    expect(result).toEqual([]);
  });

  it("returns empty array on request error", async () => {
    mockRequest.mockRejectedValue(new Error("Timeout"));

    const client = makeClient();
    const result = await substitutionBoardMessages(client);

    expect(result).toEqual([]);
  });
});
