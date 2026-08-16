import crypto from 'crypto';

/**
 * Deterministic short ID from arbitrary text (article URL/title). Must NOT be a raw substring
 * of hex-encoded bytes (`Buffer.from(text).toString('hex').slice(0, 16)`) — that collided
 * constantly in practice because most article URLs share the same 8-byte "https://" prefix,
 * which encodes to the same first 16 hex characters regardless of the rest of the URL.
 */
export function hashId(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}
