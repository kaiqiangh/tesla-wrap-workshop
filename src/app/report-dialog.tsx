"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

type TargetKind = "WRAP" | "COMMENT" | "USER";

const reasons = [
  ["COPYRIGHT", "Copyright"],
  ["OFFENSIVE_CONTENT", "Offensive Content"],
  ["SPAM", "Spam"],
  ["STOLEN_CONTENT", "Stolen Content"],
  ["WRONG_VEHICLE_OR_TEMPLATE", "Wrong Vehicle or Template"],
  ["INVALID_DOWNLOAD", "Invalid Download"],
  ["OTHER", "Other"],
] as const;

type Props = {
  targetKind: TargetKind;
  target: string;
  label?: string;
};

export function ReportDialog({ targetKind, target, label = "Report" }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("COPYRIGHT");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<{
    id: string;
    status: string;
    created: boolean;
  } | null>(null);
  const titleId = useId();
  const reasonId = `${titleId}-reason`;
  const detailId = `${titleId}-detail`;
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const returnFocus = triggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) setOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      (previous ?? returnFocus)?.focus();
    };
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetKind,
          target,
          reason,
          detail: detail || null,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const body = (await response.json()) as {
        report?: { id: string; status: string; created: boolean };
        error?: { problem?: string; nextAction?: string };
      };
      if (response.status === 401) {
        router.push(`/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok || !body.report) {
        throw new Error(
          [body.error?.problem, body.error?.nextAction]
            .filter(Boolean)
            .join(" ") || "The Report could not be submitted.",
        );
      }
      setReceipt(body.report);
      setMessage(
        body.report.created
          ? "Report received. An administrator will review it privately."
          : "This Report is already recorded and remains in the review queue.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The Report could not be submitted. Retry shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="text-link report-trigger"
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
      >
        {label}
      </button>
      {open ? (
        <div className="report-dialog-backdrop" role="presentation">
          <section
            className="report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={dialogRef}
            tabIndex={-1}
          >
            <div className="report-dialog-heading">
              <div>
                <p className="eyebrow">PRIVATE REPORT</p>
                <h2 id={titleId}>Report this target</h2>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Close
              </button>
            </div>
            {receipt ? (
              <div className="report-receipt" role="status">
                <strong>Report {receipt.status}</strong>
                <span>
                  Keep this receipt private. The Report is visible only to you
                  and authorized administrators.
                </span>
              </div>
            ) : (
              <form className="report-form" onSubmit={submit}>
                <label htmlFor={reasonId}>Reason</label>
                <select
                  id={reasonId}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {reasons.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
                <label htmlFor={detailId}>
                  Additional detail{" "}
                  {reason === "OTHER" ? "(required)" : "(optional)"}
                </label>
                <textarea
                  id={detailId}
                  value={detail}
                  maxLength={1000}
                  rows={4}
                  disabled={busy}
                  required={reason === "OTHER"}
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder="Share concise plain-text context."
                />
                <div className="report-form-footer">
                  <span>{detail.length}/1,000</span>
                  <button className="button" type="submit" disabled={busy}>
                    {busy ? "Sending…" : "Submit Report"}
                  </button>
                </div>
              </form>
            )}
            <p className="form-message" role="status" aria-live="polite">
              {message}
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
