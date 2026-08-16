"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Props = { next: string };
type ApiError = { error?: { message?: string } };

export function OnboardingForm({ next }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          displayName: form.get("displayName"),
        }),
      });
      const result = (await response.json()) as ApiError & {
        username?: string;
      };
      if (!response.ok || !result.username) {
        setMessage(
          result.error?.message ??
            "We could not save your Profile. Please try again.",
        );
        return;
      }
      router.replace(next === "/" ? `/u/${result.username}` : next);
      router.refresh();
    } catch {
      setMessage("The connection failed. Your details were not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        minLength={3}
        maxLength={30}
        pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,29}"
        aria-describedby="username-help"
        required
      />
      <p className="field-help" id="username-help">
        3–30 letters, numbers, underscores, or dashes. Starts with a letter or
        number.
      </p>
      <label htmlFor="display-name">Display name</label>
      <input
        id="display-name"
        name="displayName"
        autoComplete="name"
        maxLength={60}
        required
      />
      <button className="button" type="submit" disabled={busy}>
        Complete Profile
      </button>
      <p className="form-message" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
