create table signatures (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  message text not null default '' check (char_length(message) <= 280),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index signatures_ip_hash_created on signatures (ip_hash, created_at);

alter table signatures enable row level security;
revoke all on signatures from anon, authenticated;
grant all on signatures to service_role;

create function list_signatures() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', name, 'message', message, 'created_at', created_at)
      order by created_at desc, id desc
    ),
    '[]'::jsonb
  )
  from signatures;
$$;

-- Returns null when this ip_hash already signed 5 times in the last hour.
create function add_signature(p_name text, p_message text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v signatures;
begin
  if (select count(*) from signatures
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return null;
  end if;
  insert into signatures (name, message, ip_hash) values (p_name, p_message, p_ip_hash)
  returning * into v;
  return jsonb_build_object('name', v.name, 'message', v.message, 'created_at', v.created_at);
end;
$$;

revoke all on function list_signatures() from public, anon, authenticated;
revoke all on function add_signature(text, text, text) from public, anon, authenticated;
grant execute on function list_signatures() to service_role;
grant execute on function add_signature(text, text, text) to service_role;
