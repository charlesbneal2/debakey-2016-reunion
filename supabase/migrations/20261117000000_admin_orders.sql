create function admin_orders() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'buyer_name', o.buyer_name,
        'email', o.email,
        'guest_name', o.guest_name,
        'with_guest', exists (select 1 from tickets t where t.order_id = o.id and t.kind = 'guest'),
        'status', o.status,
        'created_at', o.created_at
      )
      order by o.created_at, o.id
    ),
    '[]'::jsonb
  )
  from orders o;
$$;

revoke all on function admin_orders() from public, anon, authenticated;
grant execute on function admin_orders() to service_role;
