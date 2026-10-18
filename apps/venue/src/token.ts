import { createHash, randomBytes } from "node:crypto";

/** 128-bit single-use pay token. The token is a bearer credential: only its hash is stored. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(16).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
