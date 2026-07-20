import { StatusBadge, type StatusTone } from '../../../components/ui/StatusBadge';

const STATUS: Record<string, { icon: string; tone: StatusTone }> = {
  pending: { icon: '◷', tone: 'warning' },
  confirmed: { icon: '✓', tone: 'success' },
  completed: { icon: '✓', tone: 'success' },
  cancelled: { icon: '!', tone: 'danger' },
  no_show: { icon: '!', tone: 'danger' },
  blocked: { icon: '•', tone: 'neutral' },
};

export function BookingStatusPill({ status }: { status: string }) {
  const presentation = STATUS[status] ?? { icon: '•', tone: 'neutral' as const };
  return <StatusBadge icon={presentation.icon} label={status.replace('_', ' ')} tone={presentation.tone} />;
}
