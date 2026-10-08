import { seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";

// A per-account list of the account's app installs, for presence only: no
// commands, push, or remote access go through it. Devices of other accounts
// are never addressable, and the name is sealed with the account.
const purpose = "open-muse-account-device";
const LIMIT = 20;
const deviceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Row = {
  device_id: string;
  platform: string;
  app_version: string;
  revision: number;
  encrypted: string;
  last_seen_at: number;
};

export function validDeviceId(id: string) {
  if (!deviceId.test(id)) throw new HttpError(404, "Endpoint not found.");
  return id;
}

export function deviceInput(input: Record<string, unknown>) {
  if (
    typeof input.name !== "string" ||
    !/^[^\r\n\u0000-\u001f]{1,80}$/.test(input.name.trim()) ||
    !["mac", "ios", "android"].includes(input.platform as string) ||
    typeof input.app_version !== "string" ||
    !/^[0-9A-Za-z.+-]{1,40}$/.test(input.app_version) ||
    Object.keys(input).some(
      (key) => !["name", "platform", "app_version"].includes(key),
    )
  )
    throw new HttpError(400, "Describe this device with a name and platform.");
  return {
    name: input.name.trim(),
    platform: input.platform as "mac" | "ios" | "android",
    app_version: input.app_version,
  };
}

export class AccountDevices {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  private async view(row: Row) {
    const value = (await unseal(
      this.env,
      purpose,
      this.owner,
      row.revision,
      row.encrypted,
    )) as { id?: unknown; name?: unknown };
    // The sealed value names its device, so rows cannot be swapped.
    if (value.id !== row.device_id || typeof value.name !== "string")
      throw new HttpError(503, "A saved device could not be read.");
    return {
      id: row.device_id,
      name: value.name,
      platform: row.platform,
      app_version: row.app_version,
      last_seen_at: row.last_seen_at,
    };
  }

  private row(id: string) {
    return this.env.DB.prepare(
      "SELECT device_id,platform,app_version,revision,encrypted,last_seen_at FROM account_devices WHERE owner_id=? AND device_id=?",
    )
      .bind(this.owner, id)
      .first<Row>();
  }

  async list() {
    const rows = await this.env.DB.prepare(
      "SELECT device_id,platform,app_version,revision,encrypted,last_seen_at FROM account_devices WHERE owner_id=? ORDER BY last_seen_at DESC,device_id",
    )
      .bind(this.owner)
      .all<Row>();
    const devices = [];
    for (const row of rows.results) {
      try {
        devices.push(await this.view(row));
      } catch {
        /* Skip a row that cannot be read under the current keyring. */
      }
    }
    return { devices };
  }

  async register(
    id: string,
    input: ReturnType<typeof deviceInput>,
    now = Date.now(),
  ) {
    const current = await this.row(id);
    const revision = (current?.revision ?? 0) + 1;
    const encrypted = await seal(this.env, purpose, this.owner, revision, {
      id,
      name: input.name,
    });
    if (current) {
      const updated = await this.env.DB.prepare(
        `UPDATE account_devices SET platform=?,app_version=?,revision=?,encrypted=?,last_seen_at=?
        WHERE owner_id=? AND device_id=? AND revision=?`,
      )
        .bind(
          input.platform,
          input.app_version,
          revision,
          encrypted,
          now,
          this.owner,
          id,
          current.revision,
        )
        .run();
      if (!updated.meta.changes)
        throw new HttpError(409, "This device changed. Try again.");
    } else {
      // The cap is checked in the same statement that inserts the device.
      const inserted = await this.env.DB.prepare(
        `INSERT INTO account_devices(owner_id,device_id,platform,app_version,revision,encrypted,created_at,last_seen_at)
        SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM account_devices WHERE owner_id=?)<?
        ON CONFLICT DO NOTHING`,
      )
        .bind(
          this.owner,
          id,
          input.platform,
          input.app_version,
          revision,
          encrypted,
          now,
          now,
          this.owner,
          LIMIT,
        )
        .run();
      if (!inserted.meta.changes)
        throw new HttpError(
          409,
          "This account has too many devices. Forget one before adding another.",
        );
    }
    return this.view((await this.row(id))!);
  }

  async forget(id: string) {
    await this.env.DB.prepare(
      "DELETE FROM account_devices WHERE owner_id=? AND device_id=?",
    )
      .bind(this.owner, id)
      .run();
    return { ok: true };
  }
}
