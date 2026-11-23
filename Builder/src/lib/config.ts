export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function validateSupabaseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid Supabase URL, such as https://your-project.supabase.co.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Supabase URLs must use HTTPS (HTTP is allowed only for local Supabase).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The Supabase URL must not contain credentials, query parameters, or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateKey(value: string, label: string) {
  if (value.length > 4096) throw new Error(`${label} is unexpectedly long.`);
  if (/[\r\n\0]/.test(value)) throw new Error(`${label} contains invalid characters.`);
  return value.trim();
}

export function parseExtraEnv(source: string) {
  if (source.length > 20_000) throw new Error("Additional environment variables exceed the 20 KB limit.");
  const result: Record<string, string> = {};
  const reserved = new Set(["PATH", "HOME", "NODE_OPTIONS", "DATABASE_URL", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]);
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Environment line “${line.slice(0, 50)}” must use KEY=value format.`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    if (reserved.has(key) || /^npm_config_/i.test(key)) {
      throw new Error(`${key} is reserved by the isolated build environment.`);
    }
    if (value.includes("\0")) throw new Error(`${key} contains an invalid null character.`);
    result[key] = value;
    if (Object.keys(result).length > 40) throw new Error("A maximum of 40 additional environment variables is allowed.");
  }
  return result;
}

export function parseTimeout(value: unknown) {
  const timeout = Number(value ?? 10);
  if (![5, 10, 20].includes(timeout)) throw new Error("Build timeout must be 5, 10, or 20 minutes.");
  return timeout;
}
