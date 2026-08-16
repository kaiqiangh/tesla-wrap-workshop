"use client";

import { useState } from "react";

import { authCallbackUrl } from "@/lib/auth/redirect";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Props = { next: string; siteUrl: string };
const googleSignInErrorMessage =
  "Google sign-in is temporarily unavailable. Please try again.";

export function SignInForm({ next, siteUrl }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function continueWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const { error } =
        await createBrowserSupabaseClient().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: authCallbackUrl(siteUrl, next) },
        });
      if (!error) return;
    } catch {
      // Use the same stable message as returned provider failures.
    } finally {
      setBusy(false);
    }
    setMessage(googleSignInErrorMessage);
  }

  return (
    <div className="auth-options">
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={continueWithGoogle}
      >
        Continue with Google
      </button>
      <p className="form-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
