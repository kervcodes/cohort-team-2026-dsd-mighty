import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(next: string | null, origin: string) {
  if (!next) return "/dashboard";
  try {
    const url = new URL(next, origin);
    if (url.origin === origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    console.error("auth callback: unparseable next param", next);
  }
  return "/dashboard";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), origin);

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      console.error("auth callback: code exchange failed", error.message);
    } catch (err) {
      console.error("auth callback: unexpected error", err);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
