begin;

create table public.product_requests (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 180 and name !~ '[[:cntrl:]]'),
  manufacturer_supplier text not null check (length(manufacturer_supplier) between 1 and 180 and manufacturer_supplier = trim(manufacturer_supplier) and manufacturer_supplier !~ '[[:cntrl:]]'),
  catalogue_number text check (length(catalogue_number) between 1 and 120 and catalogue_number = trim(catalogue_number) and catalogue_number !~ '[[:cntrl:]]'),
  barcode text check (length(barcode) between 1 and 2048),
  barcode_format text check (length(barcode_format) <= 60),
  product_url text check (length(product_url) <= 2048 and product_url ~ '^https?://[^[:space:]/@]+([/?#][^[:space:]]*)?$'),
  quantity numeric not null check (quantity between 0 and 1000000000000),
  unit text not null check (unit in ('L','mL','µL','kg','g','mg','count')),
  container_count numeric not null check (container_count between 0 and 1000000000000 and container_count = trunc(container_count)),
  container_size numeric not null check (container_size > 0 and container_size <= 1000000000000),
  reason text check (length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale','cancelled')),
  response text check (length(response) <= 1000),
  item_id uuid references public.inventory_items(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (quantity <= container_count * container_size),
  check (unit <> 'count' or (quantity = trunc(quantity) and container_size = trunc(container_size)))
);
create index product_requests_lab on public.product_requests(lab_id, created_at);
create index product_requests_student on public.product_requests(student_id, created_at);
create unique index product_requests_pending_catalogue on public.product_requests(lab_id, student_id, lower(catalogue_number)) where status = 'pending' and catalogue_number is not null;
create unique index product_requests_pending_barcode on public.product_requests(lab_id, student_id, barcode) where status = 'pending' and barcode is not null;

alter table public.product_requests enable row level security;
revoke all on public.product_requests from public, anon, authenticated;
grant select on public.product_requests to authenticated;
create policy product_requests_read on public.product_requests for select to authenticated
  using (student_id = auth.uid() or private.is_owner(lab_id));

create function public.request_product_addition(p_lab_id uuid, p_name text, p_quantity numeric, p_unit text,
  p_manufacturer_supplier text, p_container_count numeric, p_container_size numeric,
  p_catalogue_number text default null, p_barcode text default null, p_barcode_format text default null,
  p_product_url text default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if not private.is_member(p_lab_id) or not exists(select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Active student membership in this lab is required.';
  end if;
  if exists(select 1 from public.inventory_items where lab_id = p_lab_id and
    (barcode = nullif(trim(p_barcode), '') or lower(catalogue_number) = lower(nullif(trim(p_catalogue_number), '')))) then
    raise exception 'A matching product already exists in this lab. Request a quantity change or ask the lab to review archived products.';
  end if;
  insert into public.product_requests(lab_id, student_id, name, manufacturer_supplier, quantity, unit, container_count, container_size,
    catalogue_number, barcode, barcode_format, product_url, reason)
  values(p_lab_id, auth.uid(), trim(p_name), trim(p_manufacturer_supplier), p_quantity, p_unit, p_container_count, p_container_size,
    nullif(trim(p_catalogue_number), ''), nullif(trim(p_barcode), ''), nullif(trim(p_barcode_format), ''), nullif(trim(p_product_url), ''), nullif(trim(p_reason), ''))
  returning id into request_id;
  return request_id;
end;
$$;

create function public.decide_product_addition(p_request_id uuid, p_approve boolean, p_response text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare request_row public.product_requests; result_status text; saved_id uuid;
begin
  select * into request_row from public.product_requests where id = p_request_id;
  if not found or not private.is_owner(request_row.lab_id) then raise exception 'Lab owner access required.'; end if;
  if p_approve is null then raise exception 'Choose approve or reject.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_row.student_id::text, 0));
  select * into request_row from public.product_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  if not exists(select 1 from public.memberships where lab_id = request_row.lab_id and student_id = request_row.student_id and active) then
    result_status := 'cancelled';
  elsif not p_approve then
    result_status := 'rejected';
  elsif exists(select 1 from public.inventory_items where lab_id = request_row.lab_id and
    (barcode = request_row.barcode or lower(catalogue_number) = lower(request_row.catalogue_number))) then
    result_status := 'stale';
  else
    saved_id := public.save_inventory_item(request_row.lab_id, request_row.name, request_row.quantity, request_row.unit,
      p_barcode => request_row.barcode, p_barcode_format => request_row.barcode_format, p_product_url => request_row.product_url,
      p_catalogue_number => request_row.catalogue_number, p_manufacturer_supplier => request_row.manufacturer_supplier,
      p_container_count => request_row.container_count, p_container_size => request_row.container_size);
    result_status := 'approved';
  end if;
  update public.product_requests set status = result_status, item_id = saved_id, decided_by = auth.uid(), decided_at = now(),
    response = case when result_status = 'cancelled' then 'Membership ended.'
      when result_status = 'stale' then 'A matching product is already in this lab. No stock was added. Request a quantity change or ask the lab to review archived products.'
      else nullif(trim(p_response), '') end where id = p_request_id;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(request_row.lab_id, auth.uid(), 'product_request.' || result_status,
      jsonb_build_object('request_id', p_request_id, 'student_id', request_row.student_id, 'item_id', saved_id,
        'name', request_row.name, 'quantity', request_row.quantity, 'unit', request_row.unit));
  return result_status;
end;
$$;

create function public.cancel_product_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  update public.product_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), response = 'Withdrawn by student.'
    where id = p_request_id and student_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Pending request not found.'; end if;
end;
$$;

create or replace function public.end_membership(p_lab_id uuid, p_student_id uuid) returns void
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
  update public.product_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid(),
    response = 'Membership ended.' where lab_id = p_lab_id and student_id = p_student_id and status = 'pending';
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(p_lab_id, auth.uid(), 'membership.ended', jsonb_build_object('student_id', p_student_id));
end;
$$;

create or replace function public.reserve_lookup() returns boolean
language plpgsql security definer set search_path = '' as $$
declare used_count integer;
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and
    (role = 'lab' or (role = 'student' and exists(select 1 from public.memberships where student_id = auth.uid() and active)))) then
    raise exception 'Lab owner or active student membership required.' using errcode = '42501';
  end if;
  insert into private.lookup_budgets(user_id, started_at, used) values(auth.uid(), clock_timestamp(), 1)
    on conflict(user_id) do update set
      used = case when private.lookup_budgets.started_at < clock_timestamp() - interval '1 minute' then 1 else private.lookup_budgets.used + 1 end,
      started_at = case when private.lookup_budgets.started_at < clock_timestamp() - interval '1 minute' then clock_timestamp() else private.lookup_budgets.started_at end
    returning used into used_count;
  return used_count <= 10;
end;
$$;

revoke execute on function public.request_product_addition(uuid, text, numeric, text, text, numeric, numeric, text, text, text, text, text),
  public.decide_product_addition(uuid, boolean, text), public.cancel_product_request(uuid) from public, anon;
grant execute on function public.request_product_addition(uuid, text, numeric, text, text, numeric, numeric, text, text, text, text, text),
  public.decide_product_addition(uuid, boolean, text), public.cancel_product_request(uuid) to authenticated;

alter publication supabase_realtime add table public.product_requests;
notify pgrst, 'reload schema';
commit;
