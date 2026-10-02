// Videos are attached as a few still frames: the model reads images, and the
// frames travel the same verified upload path as photos. Nothing but the
// frames leaves the device.

// Frames taken from one video, at most.
export const videoFrameCount = 4;
const longEdge = 1280;
const quality = 0.82;
const seekTimeout = 8000;

// Moments to sample: the middle of each of `count` equal spans, so a short
// clip still yields distinct frames and no frame sits on a fade at the ends.
export function frameTimes(duration: number, count: number) {
  if (!Number.isFinite(duration) || duration <= 0 || count < 1) return [0];
  return Array.from(
    { length: count },
    (_, index) => Math.round(((index + 0.5) * duration * 1000) / count) / 1000,
  );
}

// "IMG_0042.MOV" at 75.4s becomes "IMG_0042-frame-1m15s.jpg".
export function frameName(videoName: string, seconds: number) {
  const dot = videoName.lastIndexOf(".");
  const stem = (dot > 0 ? videoName.slice(0, dot) : videoName).trim();
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  const time = minutes ? `${minutes}m${rest}s` : `${rest}s`;
  return `${(stem || "video").slice(0, 200)}-frame-${time}.jpg`;
}

// The video a frame came from, by the name frameName gave it.
export function frameSource(name: string) {
  return name.match(/^(.+)-frame-(?:\d+m)?\d{2}s\.jpg$/)?.[1];
}

// Consecutive frames of one video, as attached together, form one group;
// anything else stays on its own.
export function groupFrames<T extends { name: string }>(items: readonly T[]) {
  const groups: { video?: string; items: T[] }[] = [];
  for (const item of items) {
    const video = frameSource(item.name);
    const last = groups.at(-1);
    if (video && last?.video === video) last.items.push(item);
    else groups.push({ video, items: [item] });
  }
  return groups;
}

// Fits a frame within the long-edge limit, keeping its aspect ratio.
export function frameSize(width: number, height: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function once(target: EventTarget, event: string) {
  return new Promise<void>((resolve, reject) => {
    const done = (failed: boolean) => () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener("error", fail);
      if (failed) reject(new Error(`video ${event} failed`));
      else resolve();
    };
    const ok = done(false);
    const fail = done(true);
    const timer = setTimeout(fail, seekTimeout);
    target.addEventListener(event, ok);
    target.addEventListener("error", fail);
  });
}

// Decodes the video in the web view and returns up to `count` JPEG frames.
export async function videoFrames(
  file: Blob & { name: string },
  count: number,
) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    // iOS loads only metadata until playback starts, so a muted inline play
    // fetches the frames; each seek then decodes the frame drawn.
    const loaded = once(video, "loadedmetadata");
    video.src = url;
    await loaded;
    await video.play().catch(() => {});
    video.pause();
    const { width, height } = frameSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    const frames: File[] = [];
    for (const time of frameTimes(video.duration, count)) {
      const seeked = once(video, "seeked");
      // A seek to the current position may not report; nudge off zero.
      video.currentTime = Math.max(time, 0.001);
      await seeked;
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob?.size) throw new Error("encode");
      frames.push(
        new File([blob], frameName(file.name, time), { type: "image/jpeg" }),
      );
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
