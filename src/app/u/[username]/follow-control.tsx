"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  username: string;
  initialFollowing: boolean;
  initialFollowerCount: number;
};

export function FollowControl({
  username,
  initialFollowing,
  initialFollowerCount,
}: Props) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    const enabled = !following;
    const previous = { following, followerCount };
    setFollowing(enabled);
    setFollowerCount((count) => Math.max(0, count + (enabled ? 1 : -1)));
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(username)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      const body = (await response.json()) as {
        following?: boolean;
        followerCount?: number;
        error?: { problem?: string };
      };
      if (response.status === 401) {
        setFollowing(previous.following);
        setFollowerCount(previous.followerCount);
        router.push(
          `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
      if (
        !response.ok ||
        typeof body.following !== "boolean" ||
        typeof body.followerCount !== "number"
      ) {
        throw new Error(body.error?.problem ?? "The Follow action failed.");
      }
      setFollowing(body.following);
      setFollowerCount(body.followerCount);
      router.refresh();
    } catch (cause) {
      setFollowing(previous.following);
      setFollowerCount(previous.followerCount);
      setError(
        cause instanceof Error
          ? cause.message
          : "The Follow action failed. Retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="follow-control">
      <button
        className="button button-secondary"
        type="button"
        aria-pressed={following}
        disabled={busy}
        onClick={toggle}
      >
        {following ? "Following" : "Follow"}
      </button>
      <span aria-live="polite">{followerCount} Followers</span>
      <p className="form-message" role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
