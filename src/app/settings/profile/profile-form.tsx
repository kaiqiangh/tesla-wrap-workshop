"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  username: string;
  displayName: string;
  bio: string;
};

export function ProfileForm({ username, displayName, bio }: Props) {
  const [values, setValues] = useState({ username, displayName, bio });
  const [avatar, setAvatar] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json().catch(() => null)) as {
        username?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setMessage(body?.error?.message ?? "Your Profile could not be saved.");
        return;
      }
      if (avatar) {
        const form = new FormData();
        form.set("avatar", avatar);
        const avatarResponse = await fetch("/api/profile/avatar", {
          method: "POST",
          body: form,
        });
        if (!avatarResponse.ok) {
          const avatarBody = (await avatarResponse
            .json()
            .catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(
            avatarBody?.error?.message ?? "Your avatar could not be saved.",
          );
          return;
        }
      }
      router.push(`/u/${body?.username ?? values.username}`);
    } catch {
      setMessage("Your Profile could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (
      !window.confirm(
        "Deactivate this Profile? Public identity and Wraps will be unavailable.",
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile/deactivate", {
        method: "POST",
      });
      if (!response.ok) {
        setMessage("Your Profile could not be deactivated. Try again.");
        return;
      }
      router.push("/");
    } catch {
      setMessage("Your Profile could not be deactivated. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-settings-form" onSubmit={save}>
      <label>
        Username
        <input
          value={values.username}
          onChange={(event) =>
            setValues({ ...values, username: event.target.value })
          }
          autoComplete="username"
          required
        />
      </label>
      <p className="form-hint">
        Username changes are limited to once every 30 days. Former names stay
        reserved.
      </p>
      <label>
        Display name
        <input
          value={values.displayName}
          onChange={(event) =>
            setValues({ ...values, displayName: event.target.value })
          }
          maxLength={60}
          required
        />
      </label>
      <label>
        Bio
        <textarea
          value={values.bio}
          onChange={(event) =>
            setValues({ ...values, bio: event.target.value })
          }
          maxLength={500}
          rows={5}
        />
      </label>
      <label>
        Avatar
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setAvatar(event.target.files?.[0] ?? null)}
        />
        <span className="form-hint">PNG, JPEG, or WebP up to 2 MiB.</span>
      </label>
      {message ? <p role="alert">{message}</p> : null}
      <div className="profile-settings-actions">
        <button className="button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save Profile"}
        </button>
        <button
          className="text-link danger-link"
          disabled={busy}
          onClick={deactivate}
          type="button"
        >
          Deactivate Profile
        </button>
      </div>
    </form>
  );
}
