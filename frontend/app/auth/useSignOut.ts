"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Ends the Supabase session, then goes to the login page.
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const signingOutRef = useRef(false);
  const router = useRouter();

  const signOut = async () => {
    // A ref, not state, so a second click before React re-renders still sees the lock.
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    setSignOutFailed(false);

    try {
      // On a failed server call auth-js still clears the local session in most cases.
      const { error } = await createClient().auth.signOut();
      if (error) console.error("Sign out error:", error);

      router.replace("/login");
      router.refresh();
    } catch (err) {
      // Thrown before the session was cleared: stay here so the user can retry.
      console.error("Unexpected sign out error:", err);
      setSignOutFailed(true);
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  };

  return { signOut, signingOut, signOutFailed };
}
