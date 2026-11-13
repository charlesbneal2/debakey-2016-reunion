-- Signatures become messages placed on one big sheet. Existing rows were test data only.
delete from signatures;

alter table signatures drop column name;
alter table signatures drop constraint signatures_message_check;
alter table signatures alter column message drop default;
alter table signatures add constraint signatures_message_check check (char_length(message) between 1 and 280);
alter table signatures add column x double precision not null check (x between 0 and 1);
alter table signatures add column y double precision not null check (y between 0 and 1);
alter table signatures add column size smallint not null check (size in (16, 24, 36, 54, 80));

drop function add_signature(text, text, text);

create or replace function list_signatures() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('message', message, 'x', x, 'y', y, 'size', size, 'created_at', created_at)
      order by created_at desc, id desc
    ),
    '[]'::jsonb
  )
  from signatures;
$$;

-- Returns null when this ip_hash already signed 5 times in the last hour.
create function add_signature(p_message text, p_x double precision, p_y double precision, p_size int, p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v signatures;
begin
  if (select count(*) from signatures
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    return null;
  end if;
  insert into signatures (message, x, y, size, ip_hash) values (p_message, p_x, p_y, p_size, p_ip_hash)
  returning * into v;
  return jsonb_build_object('message', v.message, 'x', v.x, 'y', v.y, 'size', v.size, 'created_at', v.created_at);
end;
$$;

revoke all on function list_signatures() from public, anon, authenticated;
revoke all on function add_signature(text, double precision, double precision, int, text) from public, anon, authenticated;
grant execute on function list_signatures() to service_role;
grant execute on function add_signature(text, double precision, double precision, int, text) to service_role;
