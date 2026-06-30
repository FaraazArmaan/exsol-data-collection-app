const CLASS: Record<string, string> = {
  pending: 'pill-amber', confirmed: 'pill-green', completed: 'pill-gray',
  cancelled: 'pill-red', no_show: 'pill-red', blocked: 'pill-gray',
};

export function BookingStatusPill({ status }: { status: string }) {
  return <span className={`pos-pill ${CLASS[status] ?? 'pill-gray'}`}>{status.replace('_', ' ')}</span>;
}
