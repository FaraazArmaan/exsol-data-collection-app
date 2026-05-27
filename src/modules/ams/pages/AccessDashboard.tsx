import { useParams, Link } from 'react-router-dom';

export default function AccessDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  return (
    <section>
      <h1>Access dashboard</h1>
      <p className="muted">Coming in Phase 6. Configure structure first.</p>
      <Link to={`/clients/${clientId}/configure`} className="btn btn-primary">Configure structure →</Link>
    </section>
  );
}
