import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import tasks from '../../netlify/functions/warehouse-execution-tasks';
import complete from '../../netlify/functions/warehouse-execution-task-complete';
import ordersTasks from '../../netlify/functions/warehouse-orders-execution-tasks';
import { makeBucketUserRequest, seedProducts } from '../pos/_helpers';
import { seedOrdersClient, seedSale } from '../orders/_helpers';
import { enableWarehouse, randName, seedLocation } from './_helpers';
const sql=neon(process.env.DATABASE_URL!);
describe('warehouse execution evidence', () => {
  it('accepts an Orders-originated task, publishes replay-safe evidence, and never advances Orders', async () => {
    const originalToken=process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN;
    process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN='warehouse-orders-test-token';
    try {
    const ctx=await seedOrdersClient(); await enableWarehouse(ctx);
    const { saleId }=await seedSale(ctx,{status:'fulfilled',channel:'pickup',total:100});
    const [productId]=await seedProducts(ctx.clientId,[{name:randName('Pick')}]);
    const line=(await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Pick',100,1,100,1) RETURNING id`) as Array<{id:string}>;
    const fulfillment=(await sql`INSERT INTO public.orders_fulfillments (client_id,sale_id,label) VALUES (${ctx.clientId}::uuid,${saleId}::uuid,'Pick') RETURNING id`) as Array<{id:string}>;
    const fline=(await sql`INSERT INTO public.orders_fulfillment_lines (fulfillment_id,sale_line_id,qty) VALUES (${fulfillment[0]!.id}::uuid,${line[0]!.id}::uuid,1) RETURNING id`) as Array<{id:string}>;
    const location=await seedLocation(ctx,randName('Pick bin'));
    const body={client_id:ctx.clientId,kind:'pick',idempotency_key:randName('pick'),fulfillment_line_id:fline[0]!.id,location_id:location,qty:1};
    expect((await tasks(makeBucketUserRequest(ctx,'POST','/api/warehouse/execution-tasks',body))).status).toBe(403);
    expect((await ordersTasks(new Request('http://localhost/api/internal/orders/warehouse-execution-tasks',{method:'POST',body:JSON.stringify(body)}))).status).toBe(401);
    const serviceHeaders={'content-type':'application/json','x-exsol-orders-warehouse-token':'warehouse-orders-test-token'};
    expect((await ordersTasks(new Request('http://localhost/api/internal/orders/warehouse-execution-tasks',{method:'POST',headers:serviceHeaders,body:'null'}))).status).toBe(400);
    const first=await ordersTasks(new Request('http://localhost/api/internal/orders/warehouse-execution-tasks',{method:'POST',headers:serviceHeaders,body:JSON.stringify(body)})); expect(first.status).toBe(201);
    const task=(await first.json()).task as {id:string};
    expect((await ordersTasks(new Request('http://localhost/api/internal/orders/warehouse-execution-tasks',{method:'POST',headers:serviceHeaders,body:JSON.stringify(body)}))).status).toBe(200);
    const done=await complete(makeBucketUserRequest(ctx,'POST','/api/warehouse/execution-task-complete',{task_id:task.id,outcome:'completed',evidence:{scanner:'ok'}}));
    expect(done.status).toBe(200);
    expect((await sql`SELECT status FROM public.orders_fulfillments WHERE id=${fulfillment[0]!.id}::uuid` as Array<{status:string}>)[0]!.status).toBe('pending');
    const evidence=await ordersTasks(new Request(`http://localhost/api/internal/orders/warehouse-execution-tasks?client_id=${ctx.clientId}&fulfillment_line_id=${fline[0]!.id}`,{headers:serviceHeaders}));
    expect(evidence.status).toBe(200);
    expect((await evidence.json()).evidence).toEqual([expect.objectContaining({task_id:task.id,fulfillment_line_id:fline[0]!.id,kind:'pick',outcome:'completed',completed_quantity:1,evidence:{scanner:'ok'},correlation_id:body.idempotency_key})]);
    } finally {
      if (originalToken === undefined) delete process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN;
      else process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN=originalToken;
    }
  });
});
