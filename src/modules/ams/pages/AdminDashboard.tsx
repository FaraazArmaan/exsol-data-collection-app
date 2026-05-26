export default function AdminDashboard() {
  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Clients</h1>
        <button className="btn btn-primary" disabled>+ Add Client</button>
      </header>
      <p className="muted">No clients yet — Add Client wiring lands in Phase 6.</p>
    </section>
  );
}
