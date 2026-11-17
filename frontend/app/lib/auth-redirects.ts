// Where auth sends people: the proxy, the email confirmation callback and the
// login form all decide here, so a `next` param is checked in one place.

// Where a signed-in user lands when nothing else was asked for.
export const HOME_PATH = "/dashboard";
export const LOGIN_PATH = "/login";

// Pages for signed-out visitors only.
const AUTH_PAGES = new Set([LOGIN_PATH, "/signup"]);

function isPublicPath(pathname: string) {
  // /auth/callback confirms an email signed in or out.
  return AUTH_PAGES.has(pathname) || pathname.startsWith("/auth/");
}

// `next` as a path on this site (with its query and hash), or HOME_PATH. Another
// origin (`https://evil.com`, `//evil.com`) would be an open redirect, and the
// login or signup page would send a signed-in user straight back.
export function safeNextPath(next: string | null, origin: string): string {
  if (!next) return HOME_PATH;
  try {
    const url = new URL(next, origin);
    if (url.origin === origin && !AUTH_PAGES.has(url.pathname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    console.error("safeNextPath: unparseable next param", next);
  }
  return HOME_PATH;
}

// The proxy's decision for a request: the path to redirect to, or null to let it
// through. Signed-out visitors go to login and come back afterwards; signed-in
// users skip login and signup.
export function accessRedirect(url: URL, signedIn: boolean): string | null {
  if (signedIn) {
    return AUTH_PAGES.has(url.pathname)
      ? safeNextPath(url.searchParams.get("next"), url.origin)
      : null;
  }
  if (isPublicPath(url.pathname)) return null;
  const next = new URLSearchParams({ next: `${url.pathname}${url.search}` });
  return `${LOGIN_PATH}?${next}`;
}
