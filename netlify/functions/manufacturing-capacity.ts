// GET /api/manufacturing/capacity?from=&to= — resource-hours load per day over a
// window (default today..+13). For each resource-day it sums the estimated hours of
// active orders due that day and flags days where booked > the resource's daily
// capacity. Returns resources too, so idle work centers still render.
// (manufacturing.business.view)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/capacity', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireManufacturing(req, ['manufacturing.business.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || null; // null → default window in SQL
  const to = url.searchParams.get('to') || null;

  const sql = db();
  const resources = (await sql`
    SELECT id, name, hours_per_day FROM public.manufacturing_resources
    WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY name ASC
  `) as unknown[];

  const rows = (await sql`
    SELECT r.id AS resource_id, r.name AS resource_name, r.hours_per_day AS capacity,
           to_char(po.due_on, 'YYYY-MM-DD') AS day,
           sum(po.estimated_hours)::int AS booked
    FROM public.manufacturing_resources r
    JOIN public.production_orders po
      ON po.resource_id = r.id AND po.client_id = r.client_id
    WHERE r.client_id = ${a.ctx.clientId}::uuid
      AND po.due_on IS NOT NULL
      AND po.status IN ('planned', 'in_progress')
      AND po.due_on BETWEEN COALESCE(${from}::date, current_date) AND COALESCE(${to}::date, current_date + 13)
    GROUP BY r.id, r.name, r.hours_per_day, po.due_on
    ORDER BY r.name ASC, po.due_on ASC
  `) as Array<{ resource_id: string; resource_name: string; capacity: number; day: string; booked: number }>;

  const slots = rows.map((r) => ({
    resource_id: r.resource_id,
    resource_name: r.resource_name,
    capacity: Number(r.capacity),
    day: r.day,
    booked: Number(r.booked),
    overbooked: Number(r.booked) > Number(r.capacity),
  }));

  return jsonOk({ resources, slots });
}
