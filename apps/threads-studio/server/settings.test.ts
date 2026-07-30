import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock db module
vi.mock("./db", () => ({
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
}));

// Mock threadsApi module
vi.mock("./threadsApi", () => ({
  getThreadsUserId: vi.fn(),
  publishTextPost: vi.fn(),
}));

import * as db from "./db";
import * as threadsApi from "./threadsApi";

describe("Settings router logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSettings returns masked token when token exists", async () => {
    vi.mocked(db.getSettings).mockResolvedValue({
      id: 1,
      threadsAccessToken: "real-secret-token",
      threadsUserId: "12345",
      morningCronTaskUid: null,
      eveningCronTaskUid: null,
      updatedAt: new Date(),
    });
    const s = await db.getSettings();
    expect(s?.threadsAccessToken).toBe("real-secret-token");
    expect(s?.threadsUserId).toBe("12345");
  });

  it("getThreadsUserId is called when userId is not provided", async () => {
    vi.mocked(threadsApi.getThreadsUserId).mockResolvedValue("auto-user-id");
    vi.mocked(db.upsertSettings).mockResolvedValue(undefined);

    const userId = await threadsApi.getThreadsUserId("some-token");
    expect(userId).toBe("auto-user-id");
    expect(threadsApi.getThreadsUserId).toHaveBeenCalledWith("some-token");
  });

  it("publishTextPost constructs correct 2-step flow", async () => {
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({
      containerId: "container-123",
      postId: "post-456",
    });

    const result = await threadsApi.publishTextPost("token", "userId", "Hello Threads!");
    expect(result.containerId).toBe("container-123");
    expect(result.postId).toBe("post-456");
    expect(threadsApi.publishTextPost).toHaveBeenCalledWith("token", "userId", "Hello Threads!");
  });
});
