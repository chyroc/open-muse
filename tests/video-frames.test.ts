import { describe, expect, it } from "vitest";
import { checkAttachment } from "../shared/attachments";
import {
  frameName,
  frameSize,
  frameTimes,
  videoFrameCount,
} from "../src/videoFrames";

describe("Video frames", () => {
  it("samples the middle of equal spans", () => {
    expect(frameTimes(8, 4)).toEqual([1, 3, 5, 7]);
    expect(frameTimes(1, 2)).toEqual([0.25, 0.75]);
    expect(frameTimes(10, 1)).toEqual([5]);
  });
  it("falls back to the first frame when the length is unknown", () => {
    expect(frameTimes(Number.NaN, 4)).toEqual([0]);
    expect(frameTimes(Infinity, 4)).toEqual([0]);
    expect(frameTimes(0, 4)).toEqual([0]);
    expect(frameTimes(5, 0)).toEqual([0]);
  });
  it("names frames after the video and their moment", () => {
    expect(frameName("IMG_0042.MOV", 75.4)).toBe("IMG_0042-frame-1m15s.jpg");
    expect(frameName("clip.mp4", 3.9)).toBe("clip-frame-03s.jpg");
    expect(frameName(".mov", 0)).toBe(".mov-frame-00s.jpg");
    expect(frameName("  ", 0)).toBe("video-frame-00s.jpg");
  });
  it("produces names and sizes the image upload accepts", () => {
    const name = frameName(`${"a".repeat(300)}.mov`, 12);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(checkAttachment(name, "image/jpeg", 1, videoFrameCount - 1)).toEqual(
      { kind: "image", mime: "image/jpeg", inline: false },
    );
  });
  it("fits frames within 1280 pixels, keeping the aspect ratio", () => {
    expect(frameSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(frameSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(frameSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});
