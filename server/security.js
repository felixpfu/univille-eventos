import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const scryptAsync = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !salt || !/^[a-f0-9]{128}$/.test(hex || ""))
    return false;
  const actual = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}

export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export const createToken = () => randomBytes(32).toString("base64url");
export const publicUser = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        active: Boolean(row.active),
      }
    : null;

export function cookieValue(req, name) {
  const entry = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return null;
  }
}
