"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { authCallbackUrl } from "@/lib/auth/redirect";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Props = { next: string; siteUrl: string; googleEnabled: boolean };

export function SignInForm({ next, siteUrl, googleEnabled }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    if (!codeSent) {
      let response: Response;
      try {
        response = await fetch("/api/auth/otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "send", email }),
        });
      } catch {
        setBusy(false);
        setMessage(
          "We could not reach sign-in. Check your connection and try again.",
        );
        return;
      }
      setBusy(false);
      if (!response.ok) {
        setMessage("We could not send a code. Wait a moment and try again.");
        return;
      }
      setCodeSent(true);
      setMessage("Check your inbox for the six-digit code.");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", email, token: code }),
      });
    } catch {
      setBusy(false);
      setMessage(
        "We could not reach sign-in. Check your connection and try again.",
      );
      return;
    }
    setBusy(false);
    if (!response.ok) {
      setMessage(
        "That code is invalid or expired. Request a new code and try again.",
      );
      return;
    }
    router.replace(`/auth/complete?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  async function continueWithGoogle() {
    setBusy(true);
    setMessage("");
    const { error } = await createBrowserSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authCallbackUrl(siteUrl, next) },
    });
    setBusy(false);
    if (error) {
      setMessage(
        "Google sign-in is not available in this environment. Use email instead.",
      );
    }
  }

  return (
    <div className="auth-options">
      <form className="auth-form" onSubmit={submitEmail}>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={codeSent || busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        {codeSent ? (
          <>
            <label htmlFor="otp">Six-digit code</label>
            <input
              id="otp"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button className="button" type="submit" disabled={busy}>
              Verify code
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setMessage("");
              }}
            >
              Send a new code
            </button>
          </>
        ) : (
          <button className="button" type="submit" disabled={busy}>
            Send six-digit code
          </button>
        )}
      </form>
      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>
      <button
        className="button button-secondary"
        type="button"
        disabled={busy || !googleEnabled}
        onClick={continueWithGoogle}
      >
        Continue with Google
      </button>
      {!googleEnabled ? (
        <p className="field-help">
          Google sign-in is enabled in the hosted development Environment Pair.
        </p>
      ) : null}
      <p className="form-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
