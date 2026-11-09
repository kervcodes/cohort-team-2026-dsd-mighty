"use client";

import { isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { getMe } from "@/lib/api/me";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/user";

const PROFILE_LOAD_FAILED = "Unable to load your account.";

type AuthContextType = {
  user: User | null;
  // From `GET /me`; the frontend never reads `app_users` itself (no SELECT policy).
  profile: Profile | null;
  // Why a signed-in user's profile could not be loaded, ready to show to them.
  profileError: string | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    // Only the latest load may set state, so a slow answer for an earlier
    // sign-in never overwrites the current one.
    let latestLoad = 0;
    // The user whose profile is loaded or loading.
    let profileUserId: string | null = null;

    async function fetchProfile(load: number) {
      try {
        const me = await getMe();
        if (!active || load !== latestLoad) return;
        setProfile(me);
        setProfileError(null);
      } catch (error) {
        if (!active || load !== latestLoad) return;
        // Shown to the user by AuthGate; a warning, not an error, in the console.
        console.warn("Error loading profile:", error);
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : PROFILE_LOAD_FAILED);
      } finally {
        if (active && load === latestLoad) setLoading(false);
      }
    }

    // Supabase reports a restored session as SIGNED_IN while getUser() is
    // still checking it, so the same user arrives twice: load them once. A
    // refresh (USER_UPDATED) reloads in place, keeping the profile shown.
    function loadProfile(userId: string, refresh = false) {
      if (userId === profileUserId && !refresh) return;
      const load = ++latestLoad;
      if (userId !== profileUserId) setLoading(true);
      profileUserId = userId;
      // Supabase runs auth callbacks under its auth lock, and /me reads the
      // session again, so start the request once the callback has returned.
      setTimeout(() => {
        if (active) void fetchProfile(load);
      }, 0);
    }

    function clearProfile() {
      latestLoad++;
      profileUserId = null;
      setProfile(null);
      setProfileError(null);
      setLoading(false);
    }

    async function initialize() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!active) return;

        // Being signed out is reported as an error too; it is not one here.
        if (error && !isAuthSessionMissingError(error)) {
          console.error("Error fetching supabase user:", error);
        }

        setUser(user);
        if (user) {
          loadProfile(user.id);
        } else {
          clearProfile();
        }
      } catch (error) {
        console.error("auth context initialization error:", error);
        if (active) clearProfile();
      }
    }

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);

      if (event === "SIGNED_OUT") {
        clearProfile();
      } else if (event === "SIGNED_IN" && session?.user) {
        loadProfile(session.user.id);
      } else if (event === "USER_UPDATED" && session?.user) {
        loadProfile(session.user.id, true);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, profileError, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
