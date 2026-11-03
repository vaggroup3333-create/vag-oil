/**
 * The app is bound to loopback and sits behind the existing HTTPS reverse
 * proxy. Trust only the proxy's forwarded host/protocol when validating
 * same-origin browser writes.
 */
export function isSameOrigin(req: Request) {
  const first = (value: string | null) => value?.split(",", 1)[0]?.trim();
  const host = first(req.headers.get("x-forwarded-host")) ?? req.headers.get("host");
  const proto = first(req.headers.get("x-forwarded-proto")) ?? new URL(req.url).protocol.slice(0, -1);
  return !!host && req.headers.get("origin") === `${proto}://${host}`;
}
