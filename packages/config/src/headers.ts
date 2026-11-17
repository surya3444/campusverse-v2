// Security headers for the web and admin apps (next.config headers()). Both apps only talk to
// their own origin from the browser, so every source is 'self'. Inline scripts stay allowed for
// Next.js's start-up scripts; eval only in development, for hot reload.

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    // Browsers ignore it over plain http, so it is harmless in development.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    {
      key: 'Permissions-Policy',
      // Geolocation for this site only: staff check-in and setting a campus's gate (Milestone 20).
      value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
    },
  ];
}
