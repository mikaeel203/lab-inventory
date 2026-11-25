create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('lab', 'student')),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.labs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  department text not null check (length(trim(department)) between 1 and 160),
  institution text not null check (length(trim(institution)) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lab_id, student_id)
);
create index memberships_student on public.memberships(student_id) where active;

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  acknowledged_existing boolean not null default false,
  response text check (length(response) <= 1000),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index join_requests_pending on public.join_requests(lab_id, student_id) where status = 'pending';
create index join_requests_student on public.join_requests(student_id);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 180),
  barcode text check (length(barcode) between 1 and 2048),
  barcode_format text check (length(barcode_format) <= 60),
  quantity numeric not null check (quantity between 0 and 1000000000000),
  unit text not null check (unit in ('L','mL','µL','kg','g','mg','count')),
  product_url text check (length(product_url) <= 2048 and product_url ~ '^https?://[^[:space:]/@]+([/?#][^[:space:]]*)?$'),
  version integer not null default 1,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (lab_id, barcode),
  check (unit <> 'count' or quantity = trunc(quantity))
);

create table public.quantity_requests (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  item_name text not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  quantity numeric not null check (quantity between 0 and 1000000000000),
  unit text not null check (unit in ('L','mL','µL','kg','g','mg','count')),
  base_version integer not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale','cancelled')),
  reason text check (length(reason) <= 1000),
  response text check (length(response) <= 1000),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (unit <> 'count' or quantity = trunc(quantity))
);
create unique index quantity_requests_pending on public.quantity_requests(item_id, student_id) where status = 'pending';
create index quantity_requests_lab on public.quantity_requests(lab_id);
create index quantity_requests_student on public.quantity_requests(student_id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_lab on public.audit_events(lab_id, created_at desc);

create table private.lookup_budgets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  used integer not null
);

create function private.is_owner(target_lab uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.labs where id = target_lab and owner_id = auth.uid());
$$;
create function private.is_member(target_lab uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where lab_id = target_lab and student_id = auth.uid() and active);
$$;
create function private.can_read_profile(target_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target_user = auth.uid() or exists (
    select 1 from public.join_requests requests join public.labs labs on labs.id = requests.lab_id
    where requests.student_id = target_user and labs.owner_id = auth.uid()
  ) or exists (
    select 1 from public.memberships members join public.labs labs on labs.id = members.lab_id
    where members.student_id = target_user and labs.owner_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.labs enable row level security;
alter table public.memberships enable row level security;
alter table public.join_requests enable row level security;
alter table public.inventory_items enable row level security;
alter table public.quantity_requests enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (private.can_read_profile(id));
create policy labs_directory on public.labs for select to authenticated using (true);
create policy memberships_read on public.memberships for select to authenticated using (student_id = auth.uid() or private.is_owner(lab_id));
create policy joins_read on public.join_requests for select to authenticated using (student_id = auth.uid() or private.is_owner(lab_id));
create policy inventory_read on public.inventory_items for select to authenticated using (private.is_owner(lab_id) or (not archived and private.is_member(lab_id)));
create policy quantities_read on public.quantity_requests for select to authenticated using (student_id = auth.uid() or private.is_owner(lab_id));
create policy audit_read on public.audit_events for select to authenticated using (private.is_owner(lab_id));

revoke all on public.profiles, public.labs, public.memberships, public.join_requests,
  public.inventory_items, public.quantity_requests, public.audit_events from anon, authenticated;
grant select on public.profiles, public.labs, public.memberships, public.join_requests,
  public.inventory_items, public.quantity_requests, public.audit_events to authenticated;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_role text := new.raw_user_meta_data ->> 'role';
begin
  if account_role is null or account_role not in ('lab','student') then
    raise exception 'Choose a lab or student account.';
  end if;
  insert into public.profiles(id, role, display_name)
    values(new.id, account_role, trim(new.raw_user_meta_data ->> 'display_name'));
  if account_role = 'lab' then
    insert into public.labs(owner_id, name, department, institution)
    values(new.id, trim(new.raw_user_meta_data ->> 'lab_name'),
      trim(new.raw_user_meta_data ->> 'department'), trim(new.raw_user_meta_data ->> 'institution'));
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create function public.request_membership(p_lab_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Only students may request membership.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if private.is_member(p_lab_id) then raise exception 'You already belong to this lab.'; end if;
  insert into public.join_requests(lab_id, student_id) values(p_lab_id, auth.uid()) returning id into new_id;
  return new_id;
end;
$$;

create function public.membership_inbox(p_lab_id uuid)
returns table(id uuid, lab_id uuid, student_id uuid, status text, created_at timestamptz,
  response text, acknowledged_existing boolean, display_name text, existing_memberships bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_owner(p_lab_id) then raise exception 'Lab owner access required.'; end if;
  return query select requests.id, requests.lab_id, requests.student_id, requests.status, requests.created_at,
    requests.response, requests.acknowledged_existing, profiles.display_name,
    (select count(*) from public.memberships members
      where members.student_id = requests.student_id and members.active and members.lab_id <> p_lab_id)
    from public.join_requests requests join public.profiles profiles on profiles.id = requests.student_id
    where requests.lab_id = p_lab_id order by requests.created_at desc;
end;
$$;

create function public.decide_membership(p_request_id uuid, p_approve boolean, p_acknowledge boolean default false, p_response text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare request_row public.join_requests; existing_count integer;
begin
  select * into request_row from public.join_requests where id = p_request_id;
  if not found or not private.is_owner(request_row.lab_id) then raise exception 'Lab owner access required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_row.student_id::text, 0));
  select * into request_row from public.join_requests where id = p_request_id for update;
  if request_row.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  select count(*) into existing_count from public.memberships
    where student_id = request_row.student_id and active and lab_id <> request_row.lab_id;
  if p_approve and existing_count > 0 and not coalesce(p_acknowledge, false) then
    raise exception 'Acknowledge that this student already belongs to another lab before approving.';
  end if;
  update public.join_requests set status = case when p_approve then 'approved' else 'rejected' end,
    acknowledged_existing = coalesce(p_approve and existing_count > 0 and p_acknowledge, false),
    decided_by = auth.uid(), decided_at = now(), response = nullif(trim(p_response), '') where id = p_request_id;
  if p_approve then
    insert into public.memberships(lab_id, student_id) values(request_row.lab_id, request_row.student_id)
      on conflict(lab_id, student_id) do update set active = true, created_at = now();
  end if;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(request_row.lab_id, auth.uid(), case when p_approve then 'membership.approved' else 'membership.rejected' end,
      jsonb_build_object('request_id', p_request_id, 'student_id', request_row.student_id,
        'acknowledged_existing', coalesce(p_approve and existing_count > 0 and p_acknowledge, false)));
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

create function public.end_membership(p_lab_id uuid, p_student_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (auth.uid() <> p_student_id and not private.is_owner(p_lab_id)) then
    raise exception 'Not permitted to end this membership.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 0));
  update public.memberships set active = false where lab_id = p_lab_id and student_id = p_student_id and active;
  if not found then raise exception 'No active membership found.'; end if;
  update public.quantity_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid(),
    response = 'Membership ended.' where lab_id = p_lab_id and student_id = p_student_id and status = 'pending';
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(p_lab_id, auth.uid(), 'membership.ended', jsonb_build_object('student_id', p_student_id));
end;
$$;

create function public.cancel_join_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  update public.join_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
    where id = p_request_id and student_id = auth.uid() and status = 'pending';
  if not found then raise exception 'No pending request found.'; end if;
end;
$$;

create function public.save_inventory_item(p_lab_id uuid, p_name text, p_quantity numeric, p_unit text,
  p_barcode text default null, p_barcode_format text default null, p_product_url text default null,
  p_item_id uuid default null, p_version integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_row public.inventory_items; saved_id uuid;
begin
  if not private.is_owner(p_lab_id) then raise exception 'Lab owner access required.'; end if;
  if p_item_id is null then
    insert into public.inventory_items(lab_id, name, quantity, unit, barcode, barcode_format, product_url)
    values(p_lab_id, trim(p_name), p_quantity, p_unit, nullif(trim(p_barcode), ''),
      nullif(trim(p_barcode_format), ''), nullif(trim(p_product_url), '')) returning id into saved_id;
  else
    select * into item_row from public.inventory_items where id = p_item_id and lab_id = p_lab_id for update;
    if not found then raise exception 'Product not found.'; end if;
    if p_version is distinct from item_row.version then raise exception 'This product changed. Refresh and try again.'; end if;
    update public.inventory_items set name = trim(p_name), quantity = p_quantity, unit = p_unit,
      barcode = nullif(trim(p_barcode), ''), barcode_format = nullif(trim(p_barcode_format), ''),
      product_url = nullif(trim(p_product_url), ''), archived = false, version = version + 1, updated_at = now()
      where id = p_item_id returning id into saved_id;
  end if;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(p_lab_id, auth.uid(), case when p_item_id is null then 'product.created' else 'product.updated' end,
      jsonb_build_object('item_id', saved_id, 'name', trim(p_name), 'quantity', p_quantity, 'unit', p_unit,
        'previous_quantity', item_row.quantity, 'previous_unit', item_row.unit));
  return saved_id;
end;
$$;

create function public.archive_inventory_item(p_item_id uuid, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare item_row public.inventory_items;
begin
  select * into item_row from public.inventory_items where id = p_item_id for update;
  if not found or not private.is_owner(item_row.lab_id) then raise exception 'Lab owner access required.'; end if;
  if item_row.version is distinct from p_version then raise exception 'This product changed. Refresh and try again.'; end if;
  update public.inventory_items set archived = true, version = version + 1, updated_at = now() where id = p_item_id;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(item_row.lab_id, auth.uid(), 'product.archived', jsonb_build_object('item_id', p_item_id, 'name', item_row.name));
end;
$$;

create function public.request_quantity_change(p_item_id uuid, p_quantity numeric, p_unit text,
  p_version integer, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_row public.inventory_items; request_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into item_row from public.inventory_items where id = p_item_id for update;
  if not found or not private.is_member(item_row.lab_id) or item_row.archived then raise exception 'Active membership required.'; end if;
  if item_row.version is distinct from p_version then raise exception 'This product changed. Refresh and try again.'; end if;
  update public.quantity_requests set status = 'stale', decided_at = now(), response = 'Product changed. Please resubmit.'
    where item_id = p_item_id and student_id = auth.uid() and status = 'pending' and base_version <> item_row.version;
  insert into public.quantity_requests(lab_id, item_id, item_name, student_id, quantity, unit, base_version, reason)
    values(item_row.lab_id, p_item_id, item_row.name, auth.uid(), p_quantity, p_unit, p_version, nullif(trim(p_reason), '')) returning id into request_id;
  return request_id;
end;
$$;

create function public.decide_quantity_change(p_request_id uuid, p_approve boolean, p_response text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare request_row public.quantity_requests; item_row public.inventory_items; result_status text;
begin
  select * into request_row from public.quantity_requests where id = p_request_id;
  if not found or not private.is_owner(request_row.lab_id) then raise exception 'Lab owner access required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_row.student_id::text, 0));
  select * into request_row from public.quantity_requests where id = p_request_id for update;
  if request_row.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  select * into item_row from public.inventory_items where id = request_row.item_id for update;
  if not exists(select 1 from public.memberships where lab_id = request_row.lab_id and student_id = request_row.student_id and active) then
    result_status := 'cancelled';
  elsif item_row.archived or item_row.version <> request_row.base_version then
    result_status := 'stale';
  elsif p_approve then
    result_status := 'approved';
    update public.inventory_items set quantity = request_row.quantity, unit = request_row.unit,
      version = version + 1, updated_at = now() where id = item_row.id;
  else
    result_status := 'rejected';
  end if;
  update public.quantity_requests set status = result_status, decided_by = auth.uid(), decided_at = now(),
    response = case when result_status = 'stale' then 'Product changed. Please resubmit.'
      when result_status = 'cancelled' then 'Membership ended.' else nullif(trim(p_response), '') end
    where id = p_request_id;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(request_row.lab_id, auth.uid(), 'quantity.' || result_status,
      jsonb_build_object('request_id', p_request_id, 'item_id', request_row.item_id, 'name', item_row.name,
        'quantity', request_row.quantity, 'unit', request_row.unit,
        'previous_quantity', item_row.quantity, 'previous_unit', item_row.unit));
  return result_status;
end;
$$;

create function public.reserve_lookup() returns boolean
language plpgsql security definer set search_path = '' as $$
declare used_count integer;
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and role = 'lab') then
    raise exception 'Lab owner access required.';
  end if;
  insert into private.lookup_budgets(user_id, started_at, used) values(auth.uid(), clock_timestamp(), 1)
    on conflict(user_id) do update set
      used = case when private.lookup_budgets.started_at < clock_timestamp() - interval '1 minute' then 1 else private.lookup_budgets.used + 1 end,
      started_at = case when private.lookup_budgets.started_at < clock_timestamp() - interval '1 minute' then clock_timestamp() else private.lookup_budgets.started_at end
    returning used into used_count;
  return used_count <= 10;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_owner(uuid), private.is_member(uuid), private.can_read_profile(uuid) to authenticated;
revoke execute on function public.request_membership(uuid), public.membership_inbox(uuid),
  public.decide_membership(uuid, boolean, boolean, text), public.end_membership(uuid, uuid),
  public.cancel_join_request(uuid), public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer),
  public.archive_inventory_item(uuid, integer), public.request_quantity_change(uuid, numeric, text, integer, text),
  public.decide_quantity_change(uuid, boolean, text), public.reserve_lookup() from public, anon;
grant execute on function public.request_membership(uuid), public.membership_inbox(uuid),
  public.decide_membership(uuid, boolean, boolean, text), public.end_membership(uuid, uuid),
  public.cancel_join_request(uuid), public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer),
  public.archive_inventory_item(uuid, integer), public.request_quantity_change(uuid, numeric, text, integer, text),
  public.decide_quantity_change(uuid, boolean, text), public.reserve_lookup() to authenticated;
