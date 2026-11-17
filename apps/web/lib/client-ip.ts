// Pure: no configuration, so it can be tested anywhere.
/**
 * The client's address for the API's per-IP limits. The load balancer appends the address it saw
 * to X-Forwarded-For, so the last entry is trustworthy; earlier ones can be set by the client.
 */
export function clientIp(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || null;
}
