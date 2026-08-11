export default function AdminReportsLoading() {
  return (
    <main className="admin-shell" aria-busy="true" aria-live="polite">
      <section className="admin-state" role="status">
        <p className="eyebrow">PRIVATE ADMIN AREA</p>
        <h1>Loading moderation queue…</h1>
        <p>Checking current administrator access and Report state.</p>
      </section>
    </main>
  );
}
