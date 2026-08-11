"use client";

import { useRef, useState } from "react";

type AdminReport = {
  id: string;
  targetKind: string;
  targetId: string;
  targetRef: string;
  targetSummary: string | null;
  targetState: string | null;
  reporterRef: string;
  reason: string;
  detail: string | null;
  status: string;
  outcomeCategory: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  lastActionKind: string | null;
  lastActionReason: string | null;
  lastActionAt: string | null;
};

type Props = { initialReports: AdminReport[] };

export function AdminReportsQueue({ initialReports }: Props) {
  const [reports, setReports] = useState(initialReports);
  const [filter, setFilter] = useState("ALL");
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryKeys = useRef(new Map<string, string>());

  async function refresh(nextFilter = filter) {
    setBusy("refresh");
    setError(null);
    try {
      const query = nextFilter === "ALL" ? "" : `?status=${nextFilter}`;
      const response = await fetch(`/api/admin/reports${query}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.problem ?? "Queue unavailable.");
      setReports(body.reports);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Queue unavailable.");
    } finally {
      setBusy(null);
    }
  }

  async function moderate(report: AdminReport, actionKind: string) {
    const key = `${report.id}:${actionKind}`;
    const idempotencyKey = retryKeys.current.get(key) ?? crypto.randomUUID();
    retryKeys.current.set(key, idempotencyKey);
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          actionKind,
          reason: reasonFor(report, actionKind),
          privateNote: note[report.id] ?? "",
          outcomeCategory: outcomeFor(actionKind) || undefined,
          idempotencyKey,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.problem ?? "Moderation unavailable.");
      retryKeys.current.delete(key);
      const result = body.moderation;
      setReports((current) =>
        current.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: result.reportStatus,
                outcomeCategory: result.outcomeCategory,
                targetState: result.targetState,
                lastActionKind: actionKind,
                lastActionReason: reasonFor(report, actionKind),
                lastActionAt: new Date().toISOString(),
                resolvedAt:
                  result.reportStatus === "OPEN" ||
                  result.reportStatus === "REVIEWING"
                    ? null
                    : (item.resolvedAt ?? new Date().toISOString()),
              }
            : item,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Moderation unavailable.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-queue" aria-labelledby="admin-queue-title">
      <div className="admin-queue-toolbar">
        <div>
          <p className="eyebrow">PRIVATE ADMIN QUEUE</p>
          <h1 id="admin-queue-title">Reports</h1>
        </div>
        <div className="admin-queue-filters" aria-label="Report status filter">
          <label>
            Status
            <select
              value={filter}
              onChange={(event) => {
                const next = event.target.value;
                setFilter(next);
                void refresh(next);
              }}
            >
              <option value="ALL">All</option>
              <option value="OPEN">Open</option>
              <option value="REVIEWING">Reviewing</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            onClick={() => void refresh()}
            disabled={busy !== null}
          >
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <div className="admin-state admin-state-error" role="alert">
          <strong>Queue action failed.</strong>
          <p>{error}</p>
          <button
            className="button button-secondary"
            onClick={() => void refresh()}
          >
            Retry queue
          </button>
        </div>
      )}
      {reports.length === 0 ? (
        <div className="admin-state" role="status">
          <strong>No Reports in this queue.</strong>
          <p>
            New Reports will appear here after a completed User submits one.
          </p>
        </div>
      ) : (
        <div className="admin-report-list">
          {reports.map((report) => (
            <article className="admin-report-card" key={report.id}>
              <div className="admin-report-heading">
                <div>
                  <p className="eyebrow">
                    {report.targetKind} · {report.status}
                  </p>
                  <h2>{report.targetSummary ?? "Target unavailable"}</h2>
                  <p className="admin-report-ref">
                    {report.targetRef} · reporter {report.reporterRef}
                  </p>
                </div>
                <time dateTime={report.createdAt}>
                  {new Date(report.createdAt).toLocaleString("en-IE")}
                </time>
              </div>
              <dl className="admin-report-meta">
                <div>
                  <dt>Reason</dt>
                  <dd>{report.reason}</dd>
                </div>
                <div>
                  <dt>Target state</dt>
                  <dd>{report.targetState ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>{report.outcomeCategory ?? "Pending"}</dd>
                </div>
              </dl>
              {report.detail && (
                <p className="admin-report-detail">{report.detail}</p>
              )}
              {report.adminNote && (
                <p className="admin-report-note">
                  Private note: {report.adminNote}
                </p>
              )}
              <label className="admin-report-note-input">
                Private note
                <textarea
                  value={note[report.id] ?? ""}
                  maxLength={2000}
                  onChange={(event) =>
                    setNote((current) => ({
                      ...current,
                      [report.id]: event.target.value,
                    }))
                  }
                />
              </label>
              <div
                className="admin-report-actions"
                aria-label={`Actions for ${report.targetKind} report`}
              >
                {report.status === "OPEN" && (
                  <ActionButton
                    label="Start review"
                    action="REVIEW"
                    report={report}
                    busy={busy}
                    onAction={moderate}
                  />
                )}
                {(report.status === "OPEN" ||
                  report.status === "REVIEWING") && (
                  <>
                    <ActionButton
                      label="Resolve: no action"
                      action="RESOLVE"
                      report={report}
                      busy={busy}
                      onAction={moderate}
                    />
                    <ActionButton
                      label="Dismiss duplicate"
                      action="DISMISS"
                      report={report}
                      busy={busy}
                      onAction={moderate}
                    />
                    {report.targetKind === "WRAP" ||
                    report.targetKind === "COMMENT" ? (
                      <>
                        <ActionButton
                          label="Hide target"
                          action="HIDE"
                          report={report}
                          busy={busy}
                          onAction={moderate}
                        />
                        <ActionButton
                          label="Remove target"
                          action="REMOVE"
                          report={report}
                          busy={busy}
                          onAction={moderate}
                        />
                      </>
                    ) : (
                      report.targetState === "ACTIVE" && (
                        <>
                          <ActionButton
                            label="Suspend User"
                            action="SUSPEND"
                            report={report}
                            busy={busy}
                            onAction={moderate}
                          />
                          <ActionButton
                            label="Deactivate User"
                            action="DEACTIVATE"
                            report={report}
                            busy={busy}
                            onAction={moderate}
                          />
                        </>
                      )
                    )}
                  </>
                )}
                {report.targetKind === "USER" &&
                  (report.targetState === "SUSPENDED" ||
                    report.targetState === "DEACTIVATED") && (
                    <ActionButton
                      label="Reinstate User"
                      action="REINSTATE"
                      report={report}
                      busy={busy}
                      onAction={moderate}
                    />
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  label,
  action,
  report,
  busy,
  onAction,
}: {
  label: string;
  action: string;
  report: AdminReport;
  busy: string | null;
  onAction: (report: AdminReport, action: string) => Promise<void>;
}) {
  return (
    <button
      className="button button-secondary"
      onClick={() => void onAction(report, action)}
      disabled={busy !== null}
    >
      {busy === `${report.id}:${action}` ? "Saving…" : label}
    </button>
  );
}

function reasonFor(report: AdminReport, action: string) {
  if (action === "RESOLVE") return "NO_VIOLATION";
  if (action === "DISMISS") return "DUPLICATE";
  if (action === "REINSTATE") return "RESTORED";
  return report.reason;
}

function outcomeFor(action: string) {
  if (action === "RESOLVE") return "NO_ACTION";
  if (action === "DISMISS") return "DUPLICATE";
  return "";
}
