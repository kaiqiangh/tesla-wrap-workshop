import type { Metadata } from "next";
import Link from "next/link";

import type { Database } from "@/lib/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { AdminReportsQueue } from "./admin-reports-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moderation Reports | WrapForge",
  robots: { index: false, follow: false },
};

export default async function AdminReportsPage() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_admin_reports", {
    p_status: undefined,
  });
  if (error) {
    const denied = error.message === "admin_required";
    return (
      <main className="admin-shell">
        <section className="admin-state admin-state-error" role="alert">
          <p className="eyebrow">PRIVATE ADMIN AREA</p>
          <h1>
            {denied
              ? "Moderation access denied"
              : "Moderation queue unavailable"}
          </h1>
          <p>
            {denied
              ? "Only a current administrator can open this private queue."
              : "The private queue could not be read safely. Retry after the service recovers."}
          </p>
          {denied ? (
            <Link className="button" href="/">
              Return home
            </Link>
          ) : (
            <Link className="button" href="/admin/reports">
              Retry queue
            </Link>
          )}
        </section>
      </main>
    );
  }
  return (
    <main className="admin-shell">
      <AdminReportsQueue initialReports={(data ?? []).map(toReport)} />
    </main>
  );
}

type AdminReportRow =
  Database["public"]["Functions"]["list_admin_reports"]["Returns"][number];

function toReport(result: AdminReportRow) {
  return {
    id: result.id,
    targetKind: result.target_kind,
    targetId: result.target_id,
    targetRef: result.target_ref,
    targetSummary: result.target_summary,
    targetState: result.target_state,
    reporterRef: result.reporter_ref,
    reason: result.reason,
    detail: result.detail,
    status: result.status,
    outcomeCategory: result.outcome_category,
    adminNote: result.admin_note,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
    resolvedAt: result.resolved_at,
    lastActionKind: result.last_action_kind,
    lastActionReason: result.last_action_reason,
    lastActionAt: result.last_action_at,
  };
}
