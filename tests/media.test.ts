import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { uuid } from "../shared/crypto";
import { MediaStore } from "../src/direct/media";

const blob = (bytes: number, type = "image/jpeg") =>
  new Blob([new Uint8Array(bytes)], { type });

describe("Sent media kept on this device", () => {
  it("returns a photo, and a video for any of its frames", async () => {
    const store = new MediaStore(`media-${uuid()}`);
    await store.keepImage("owner", "file-photo", blob(10));
    await store.keepVideo("owner", "video-1", blob(50, "video/quicktime"));
    await store.keepImage("owner", "file-frame", blob(20), "video-1");
    const photo = await store.media("owner", "file-photo");
    expect(photo?.kind).toBe("image");
    expect(photo?.blob.size).toBe(10);
    const video = await store.media("owner", "file-frame");
    expect(video?.kind).toBe("video");
    expect(video?.blob.size).toBe(50);
    expect(video?.kind === "video" && video.poster?.size).toBe(20);
  });
  it("keeps each identity's copies apart", async () => {
    const store = new MediaStore(`media-${uuid()}`);
    await store.keepImage("owner-a", "file-1", blob(10));
    expect(await store.media("owner-b", "file-1")).toBeUndefined();
  });
  it("falls back to the frame when the recording was not kept", async () => {
    const store = new MediaStore(`media-${uuid()}`);
    await store.keepImage("owner", "file-frame", blob(20), "video-gone");
    expect((await store.media("owner", "file-frame"))?.kind).toBe("image");
  });
  it("drops the oldest copies past the size budget", async () => {
    const store = new MediaStore(`media-${uuid()}`, 100);
    await store.keepImage("owner", "old", blob(60));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.keepImage("owner", "new", blob(60));
    expect(await store.media("owner", "old")).toBeUndefined();
    expect((await store.media("owner", "new"))?.blob.size).toBe(60);
  });
});
