"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type PublicComment = {
  id: string;
  body: string;
  author_username: string;
  author_display_name: string;
  created_at: string;
  owned_by_viewer: boolean;
};

type Props = {
  slug: string;
  initialComments: PublicComment[];
  initialCommentCount: number;
  access: "guest" | "inactive" | "active";
  initialError?: boolean;
};

export function CommentSection({
  slug,
  initialComments,
  initialCommentCount,
  access,
  initialError = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [comments, setComments] = useState(initialComments);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    initialError ? "Comments are temporarily unavailable. Retry shortly." : "",
  );
  const [commentsUnavailable, setCommentsUnavailable] = useState(initialError);
  const draftRef = useRef({ body: "", key: crypto.randomUUID() });

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    if (draftRef.current.body !== body) {
      draftRef.current = { body, key: crypto.randomUUID() };
    }
    const submittedBody = body;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/wraps/${encodeURIComponent(slug)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: submittedBody,
            idempotencyKey: draftRef.current.key,
          }),
        },
      );
      const result = (await response.json()) as {
        comment?: {
          id: string;
          body: string;
          authorUsername: string;
          authorDisplayName: string;
          createdAt: string;
        };
        commentCount?: number;
        error?: { problem?: string };
      };
      if (response.status === 401) {
        router.push(
          `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
      if (!response.ok || !result.comment) {
        throw new Error(
          result.error?.problem ?? "The Comment could not be saved.",
        );
      }
      const addedComment: PublicComment = {
        id: result.comment.id,
        body: result.comment.body,
        author_username: result.comment.authorUsername,
        author_display_name: result.comment.authorDisplayName,
        created_at: result.comment.createdAt,
        owned_by_viewer: true,
      };
      setComments((current) => [
        addedComment,
        ...current.filter((comment) => comment.id !== addedComment.id),
      ]);
      setCommentsUnavailable(false);
      if (typeof result.commentCount === "number")
        setCommentCount(result.commentCount);
      setBody("");
      draftRef.current = { body: "", key: crypto.randomUUID() };
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Comment could not be saved. Retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      const result = (await response.json()) as {
        removed?: boolean;
        commentCount?: number;
        error?: { problem?: string };
      };
      if (!response.ok || result.removed !== true) {
        throw new Error(
          result.error?.problem ?? "The Comment could not be removed.",
        );
      }
      setComments((current) => current.filter((comment) => comment.id !== id));
      if (typeof result.commentCount === "number")
        setCommentCount(result.commentCount);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Comment could not be removed. Retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  return (
    <section className="comments-section" aria-labelledby="comments-title">
      <div className="comments-heading">
        <div>
          <p className="eyebrow">COMMUNITY COMMENTS</p>
          <h2 id="comments-title">
            {commentCount} Comment{commentCount === 1 ? "" : "s"}
          </h2>
        </div>
        <p>Plain-text conversation from eligible community Users.</p>
      </div>
      {access === "guest" ? (
        <p className="comments-login">
          <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>
            Sign in
          </Link>{" "}
          to add a Comment.
        </p>
      ) : access === "inactive" ? (
        <p className="comments-login">
          Complete or restore your Profile to add a Comment.
        </p>
      ) : (
        <form className="comment-form" onSubmit={addComment}>
          <label htmlFor="comment-body">Add a Comment</label>
          <textarea
            id="comment-body"
            name="comment-body"
            required
            maxLength={1000}
            rows={4}
            value={body}
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Share a useful note about this Custom Wrap."
          />
          <div className="comment-form-footer">
            <span>{body.length}/1,000</span>
            <button
              className="button button-secondary"
              type="submit"
              disabled={busy || !body.trim()}
            >
              Add Comment
            </button>
          </div>
        </form>
      )}
      <p className="form-message" role="status" aria-live="polite">
        {error}
      </p>
      {comments.length && !commentsUnavailable ? (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li className="comment-card" key={comment.id}>
              <div className="comment-card-heading">
                <span>
                  <strong>{comment.author_display_name}</strong> @
                  {comment.author_username}
                </span>
                <time dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleDateString("en-IE")}
                </time>
              </div>
              <p>{comment.body}</p>
              {comment.owned_by_viewer ? (
                <button
                  className="text-button comment-delete"
                  type="button"
                  disabled={busy}
                  onClick={() => removeComment(comment.id)}
                >
                  Delete Comment
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="comments-empty">No public Comments yet.</p>
      )}
    </section>
  );
}
