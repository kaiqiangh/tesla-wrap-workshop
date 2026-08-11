"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  slug: string;
  initialLikeCount: number;
  initialFavoriteCount: number;
};

export function InteractionControls({
  slug,
  initialLikeCount,
  initialFavoriteCount,
}: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [favoriteCount, setFavoriteCount] = useState(initialFavoriteCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle(kind: "LIKE" | "FAVORITE") {
    if (busy) return;
    const enabled = kind === "LIKE" ? !liked : !favorited;
    const previous = { liked, favorited, likeCount, favoriteCount };
    if (kind === "LIKE") setLiked(enabled);
    else setFavorited(enabled);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wraps/${slug}/engagement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, enabled }),
      });
      const body = (await response.json()) as {
        enabled?: boolean;
        likeCount?: number;
        favoriteCount?: number;
        error?: { problem?: string };
      };
      if (response.status === 401) {
        router.push(
          `/sign-in?next=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (!response.ok || typeof body.enabled !== "boolean") {
        throw new Error(
          body.error?.problem ?? "The action could not be saved.",
        );
      }
      if (kind === "LIKE") setLiked(body.enabled);
      else setFavorited(body.enabled);
      if (typeof body.likeCount === "number") setLikeCount(body.likeCount);
      if (typeof body.favoriteCount === "number") {
        setFavoriteCount(body.favoriteCount);
      }
    } catch (cause) {
      setLiked(previous.liked);
      setFavorited(previous.favorited);
      setLikeCount(previous.likeCount);
      setFavoriteCount(previous.favoriteCount);
      setError(
        cause instanceof Error
          ? cause.message
          : "The action could not be saved. Retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="interaction-controls" aria-label="Wrap interactions">
      <button
        className="button button-secondary interaction-button"
        type="button"
        aria-pressed={liked}
        disabled={busy}
        onClick={() => toggle("LIKE")}
      >
        {liked ? "Liked" : "Like"} · {likeCount}
      </button>
      <button
        className="button button-secondary interaction-button"
        type="button"
        aria-pressed={favorited}
        disabled={busy}
        onClick={() => toggle("FAVORITE")}
      >
        {favorited ? "Favorited" : "Favorite"} · {favoriteCount}
      </button>
      <p className="form-message" role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}
