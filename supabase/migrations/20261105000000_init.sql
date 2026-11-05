create table orders (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  buyer_name text not null,
  email text not null,
  guest_name text,
  show_on_list boolean not null default false,
  amount_total int not null,
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index orders_payment_intent on orders (stripe_payment_intent);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  token text not null unique,
  holder_name text,
  kind text not null check (kind in ('classmate', 'guest')),
  voided_at timestamptz,
  checked_in_at timestamptz
);
create index tickets_order on tickets (order_id);

create table door_failures (
  ip text not null,
  at timestamptz not null default now()
);
create index door_failures_ip_at on door_failures (ip, at);

alter table orders enable row level security;
alter table tickets enable row level security;
alter table door_failures enable row level security;
revoke all on orders, tickets, door_failures from anon, authenticated;
grant all on orders, tickets, door_failures to service_role;

create function record_paid_order(
  p_session_id text,
  p_payment_intent text,
  p_buyer_name text,
  p_email text,
  p_guest_name text,
  p_with_guest boolean,
  p_show_on_list boolean,
  p_amount_total int,
  p_classmate_token text,
  p_guest_token text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into orders (
    stripe_session_id, stripe_payment_intent, buyer_name, email,
    guest_name, show_on_list, amount_total
  ) values (
    p_session_id, p_payment_intent, p_buyer_name, p_email,
    nullif(p_guest_name, ''), p_show_on_list, p_amount_total
  )
  on conflict (stripe_session_id) do nothing
  returning id into v_id;

  -- Only the delivery that created the order creates its tickets, so retries add nothing.
  if v_id is not null then
    insert into tickets (order_id, token, holder_name, kind)
    values (v_id, p_classmate_token, p_buyer_name, 'classmate');
    if p_with_guest then
      insert into tickets (order_id, token, holder_name, kind)
      values (v_id, p_guest_token, nullif(p_guest_name, ''), 'guest');
    end if;
  end if;

  return (
    select jsonb_build_object(
      'id', o.id,
      'email', o.email,
      'status', o.status,
      'email_sent_at', o.email_sent_at,
      'buyer_name', o.buyer_name,
      'tickets', (
        select jsonb_agg(
          jsonb_build_object('token', t.token, 'holder_name', t.holder_name, 'kind', t.kind)
          order by t.kind
        )
        from tickets t where t.order_id = o.id
      )
    )
    from orders o where o.stripe_session_id = p_session_id
  );
end;
$$;

create function mark_order_emailed(p_order_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  update orders set email_sent_at = now() where id = p_order_id returning to_jsonb(true);
$$;

create function mark_order_refunded(p_payment_intent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update orders set status = 'refunded'
  where stripe_payment_intent = p_payment_intent
  returning id into v_id;
  if v_id is null then
    return to_jsonb(false);
  end if;
  update tickets set voided_at = coalesce(voided_at, now()) where order_id = v_id;
  return to_jsonb(true);
end;
$$;

create function public_guest_list() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', o.buyer_name, 'plus_one', o.guest_count > 0)
      order by o.created_at, o.id
    ),
    '[]'::jsonb
  )
  from (
    select orders.*, (
      select count(*) from tickets t
      where t.order_id = orders.id and t.kind = 'guest' and t.voided_at is null
    ) as guest_count
    from orders
    where status = 'paid' and show_on_list
  ) o;
$$;

create function get_ticket(p_token text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'holder_name', t.holder_name,
    'buyer_name', o.buyer_name,
    'kind', t.kind,
    'voided', t.voided_at is not null
  )
  from tickets t join orders o on o.id = t.order_id
  where t.token = p_token;
$$;

create function check_in_ticket(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ticket tickets;
  v_buyer text;
  v_result text;
begin
  -- One atomic update decides the winner, so two scanners cannot admit the same ticket.
  update tickets set checked_in_at = now()
  where token = p_token and checked_in_at is null and voided_at is null
  returning * into v_ticket;

  if found then
    v_result := 'ok';
  else
    select * into v_ticket from tickets where token = p_token;
    if not found then
      return jsonb_build_object('result', 'not_found');
    end if;
    v_result := case when v_ticket.voided_at is not null then 'voided' else 'already' end;
  end if;

  select buyer_name into v_buyer from orders where id = v_ticket.order_id;
  return jsonb_build_object(
    'result', v_result,
    'holder_name', v_ticket.holder_name,
    'buyer_name', v_buyer,
    'kind', v_ticket.kind,
    'checked_in_at', v_ticket.checked_in_at
  );
end;
$$;

create function search_tickets(p_query text) returns jsonb
language sql security definer set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
    where length(trim(p_query)) >= 2
  ), matches as (
    select t.token, t.holder_name, o.buyer_name, t.kind,
           t.voided_at is not null as voided, t.checked_in_at
    from tickets t
    join orders o on o.id = t.order_id
    cross join q
    where t.holder_name ilike q.pattern or o.buyer_name ilike q.pattern
    order by o.buyer_name, t.kind
    limit 25
  )
  select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) from matches;
$$;

create function door_auth_allowed(p_ip text) returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(count(*) < 20)
  from door_failures
  where ip = p_ip and at > now() - interval '15 minutes';
$$;

create function door_auth_failed(p_ip text) returns jsonb
language sql security definer set search_path = public as $$
  insert into door_failures (ip) values (p_ip) returning to_jsonb(true);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'record_paid_order(text, text, text, text, text, boolean, boolean, int, text, text)',
    'mark_order_emailed(uuid)',
    'mark_order_refunded(text)',
    'public_guest_list()',
    'get_ticket(text)',
    'check_in_ticket(text)',
    'search_tickets(text)',
    'door_auth_allowed(text)',
    'door_auth_failed(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
