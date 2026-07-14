export type BookingEventSource = 'public' | 'customer' | 'vendor' | 'system' | 'payment';

export interface BookingEventInput {
  visitId: string;
  clientId: string;
  source: BookingEventSource;
  eventType: string;
  actorUserNodeId?: string | null;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string | null;
  reference?: string | null;
}

export function appendBookingEvent(sql: any, event: BookingEventInput) {
  return sql`
    INSERT INTO public.booking_events (
      visit_id, bucket_id, actor_user_node, source, event_type,
      previous_state, new_state, reason, reference
    )
    VALUES (
      ${event.visitId}::uuid, ${event.clientId}::uuid, ${event.actorUserNodeId ?? null}::uuid,
      ${event.source}, ${event.eventType}, ${JSON.stringify(event.previousState ?? {})}::jsonb,
      ${JSON.stringify(event.newState ?? {})}::jsonb, ${event.reason ?? null}, ${event.reference ?? null}
    )
  `;
}
