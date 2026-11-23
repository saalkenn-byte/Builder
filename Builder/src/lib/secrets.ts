import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILDER_ROOT } from "./builder-paths";

const KEY_PATH = path.join(BUILDER_ROOT, "master.key");
let cachedKey: Buffer | null = null;

async function encryptionKey() {
  if (cachedKey) return cachedKey;
  await mkdir(BUILDER_ROOT, { recursive: true, mode: 0o700 });
  try {
    cachedKey = await readFile(KEY_PATH);
  } catch {
    const generated = randomBytes(32);
    try {
      await writeFile(KEY_PATH, generated, { mode: 0o600, flag: "wx" });
      cachedKey = generated;
    } catch {
      cachedKey = await readFile(KEY_PATH);
    }
  }
  if (cachedKey.length !== 32) throw new Error("The builder encryption key is invalid.");
  return cachedKey;
}

export async function encryptSecret(value: string) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export async function decryptSecret(payload: string | null) {
  if (!payload) return "";
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored builder credentials cannot be decoded.");
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
