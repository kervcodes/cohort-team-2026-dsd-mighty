import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { accessRedirect } from "@/lib/auth-redirects";

type SessionCookie = { name: string; value: string; options: CookieOptions };

// Runs before every page. Reads the Supabase session from the request cookies,
// refreshing it when it has expired, and sends visitors where they belong
// (`accessRedirect`). Decides from the Supabase session alone: whether the
// account is active is AuthGate's job, once `GET /me` answers.
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  // A refresh writes new session cookies. They go on the request, so this
  // render reads the new session, and on whichever response is returned, so
  // the browser keeps it.
  const sessionCookies: SessionCookie[] = [];
  const sessionHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        sessionCookies.push(...cookiesToSet);
        // Cache-Control and friends, so a CDN never serves one user's session to another.
        Object.assign(sessionHeaders, headers);
      },
    },
  });

  let signedIn = false;
  try {
    // getUser asks Supabase Auth, so a revoked or forged session does not count.
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    signedIn = Boolean(user) && !error;
  } catch (error) {
    // Supabase could not confirm the user (network failure): treat as signed out.
    console.error("proxy: could not read the Supabase session", error);
  }

  const target = accessRedirect(new URL(request.url), signedIn);
  const response = target
    ? NextResponse.redirect(new URL(target, request.url))
    : NextResponse.next({ request });

  for (const { name, value, options } of sessionCookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(sessionHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Every path except build assets, image optimization, the favicon and static images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
