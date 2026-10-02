// Copies of what this device attached, kept so a sent photo or video can be
// opened again here: Ark keeps uploads for the agent only and offers no way
// to download them back. Records are scoped to the identity's workspace key
// and the oldest are dropped once the copies pass a size budget.
const defaultBudget = 300 * 1024 * 1024;
export const maxKeptVideoBytes = 100 * 1024 * 1024;

type Record =
  | { kind: "image"; blob: Blob; bytes: number; at: number; video?: string }
  | { kind: "video"; blob: Blob; bytes: number; at: number };

export type KeptMedia =
  { kind: "image"; blob: Blob } | { kind: "video"; blob: Blob; poster?: Blob };

export class MediaStore {
  private database?: Promise<IDBDatabase>;
  constructor(
    private name = "open-muse-media-v1",
    private budget = defaultBudget,
  ) {}
  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("media");
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
    }));
  }
  private async request<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void,
  ) {
    const db = await this.open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("media", mode);
      const request = run(tx.objectStore("media"));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  // A photo, or one frame of a video, sent from this device.
  async keepImage(owner: string, fileId: string, blob: Blob, video?: string) {
    await this.put(`${owner}:file:${fileId}`, {
      kind: "image",
      blob,
      bytes: blob.size,
      at: Date.now(),
      ...(video ? { video } : {}),
    });
  }
  // The recording a set of frames came from, when small enough to keep.
  async keepVideo(owner: string, video: string, blob: Blob) {
    if (blob.size > maxKeptVideoBytes) return;
    await this.put(`${owner}:video:${video}`, {
      kind: "video",
      blob,
      bytes: blob.size,
      at: Date.now(),
    });
  }
  // What can be shown for a sent file: the photo, or for a video frame the
  // recording itself, falling back to the frame.
  async media(owner: string, fileId: string): Promise<KeptMedia | undefined> {
    const record = await this.request<Record>("readonly", (store) =>
      store.get(`${owner}:file:${fileId}`),
    );
    if (record?.kind !== "image") return undefined;
    if (record.video) {
      const video = await this.request<Record>("readonly", (store) =>
        store.get(`${owner}:video:${record.video}`),
      );
      if (video?.kind === "video")
        return { kind: "video", blob: video.blob, poster: record.blob };
    }
    return { kind: "image", blob: record.blob };
  }
  private async put(key: string, value: Record) {
    await this.request("readwrite", (store) => store.put(value, key));
    await this.prune();
  }
  // Drops the oldest copies while the total is over budget.
  private async prune() {
    const entries: { key: IDBValidKey; bytes: number; at: number }[] = [];
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("media", "readonly");
      const cursor = tx.objectStore("media").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const value = row.value as Record;
        entries.push({ key: row.key, bytes: value.bytes, at: value.at });
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= this.budget) return;
    const drop: IDBValidKey[] = [];
    for (const entry of entries.sort((a, b) => a.at - b.at)) {
      if (total <= this.budget) break;
      drop.push(entry.key);
      total -= entry.bytes;
    }
    await this.request("readwrite", (store) => {
      for (const key of drop) store.delete(key);
    });
  }
}
