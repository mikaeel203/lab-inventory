begin;

alter table public.inventory_items
  add column manufacturer_supplier text check (manufacturer_supplier is null or (
    length(manufacturer_supplier) between 1 and 180 and manufacturer_supplier = trim(manufacturer_supplier)
    and manufacturer_supplier !~ '[[:cntrl:]]')),
  add column container_count numeric check (container_count between 0 and 1000000000000 and container_count = trunc(container_count)),
  add column container_size numeric check (container_size > 0 and container_size <= 1000000000000),
  add column minimum_containers numeric check (minimum_containers between 0 and 1000000000000 and minimum_containers = trunc(minimum_containers)),
  add column minimum_quantity numeric check (minimum_quantity between 0 and 1000000000000),
  add constraint inventory_stock_setup check (
    (manufacturer_supplier is null and container_count is null and container_size is null and minimum_containers is null and minimum_quantity is null)
    or (manufacturer_supplier is not null and container_count is not null and container_size is not null)),
  add constraint inventory_container_capacity check (quantity <= container_count * container_size),
  add constraint inventory_whole_counts check (unit <> 'count' or (
    container_size = trunc(container_size) and minimum_quantity = trunc(minimum_quantity)));

alter table public.quantity_requests add column container_count numeric
  check (container_count between 0 and 1000000000000 and container_count = trunc(container_count));

update public.quantity_requests set status = 'stale', decided_at = now(),
  response = 'Stock tracking has been upgraded. Ask your lab to complete product setup, then submit a new request with the container count.'
  where status = 'pending';

drop function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text);

create function public.save_inventory_item(p_lab_id uuid, p_name text, p_quantity numeric, p_unit text,
  p_barcode text default null, p_barcode_format text default null, p_product_url text default null,
  p_item_id uuid default null, p_version integer default null, p_catalogue_number text default null,
  p_manufacturer_supplier text default null, p_container_count numeric default null, p_container_size numeric default null,
  p_minimum_containers numeric default null, p_minimum_quantity numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  item_row public.inventory_items;
  saved_id uuid;
  violated_constraint text;
  saved_catalogue_number text := nullif(trim(p_catalogue_number), '');
begin
  if not private.is_owner(p_lab_id) then raise exception 'Lab owner access required.'; end if;
  if nullif(trim(p_manufacturer_supplier), '') is null then raise exception 'Manufacturer/Supplier is required.'; end if;
  if p_container_count is null or p_container_size is null then raise exception 'Container count and amount per container are required.'; end if;
  if p_quantity > p_container_count * p_container_size then raise exception 'Remaining quantity cannot exceed the combined container capacity.'; end if;
  if p_item_id is null then
    insert into public.inventory_items(lab_id, name, quantity, unit, barcode, barcode_format, product_url, catalogue_number,
      manufacturer_supplier, container_count, container_size, minimum_containers, minimum_quantity)
    values(p_lab_id, trim(p_name), p_quantity, p_unit, nullif(trim(p_barcode), ''),
      nullif(trim(p_barcode_format), ''), nullif(trim(p_product_url), ''), saved_catalogue_number,
      trim(p_manufacturer_supplier), p_container_count, p_container_size, p_minimum_containers, p_minimum_quantity)
    returning id into saved_id;
  else
    select * into item_row from public.inventory_items where id = p_item_id and lab_id = p_lab_id for update;
    if not found then raise exception 'Product not found.'; end if;
    if p_version is distinct from item_row.version then raise exception 'This product changed. Refresh and try again.'; end if;
    if p_catalogue_number is null then saved_catalogue_number := item_row.catalogue_number; end if;
    update public.inventory_items set name = trim(p_name), quantity = p_quantity, unit = p_unit,
      barcode = nullif(trim(p_barcode), ''), barcode_format = nullif(trim(p_barcode_format), ''),
      catalogue_number = saved_catalogue_number, manufacturer_supplier = trim(p_manufacturer_supplier),
      container_count = p_container_count, container_size = p_container_size,
      minimum_containers = p_minimum_containers, minimum_quantity = p_minimum_quantity,
      product_url = nullif(trim(p_product_url), ''), archived = false, version = version + 1, updated_at = now()
      where id = p_item_id returning id into saved_id;
  end if;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(p_lab_id, auth.uid(), case when p_item_id is null then 'product.created' else 'product.updated' end,
      jsonb_build_object('item_id', saved_id, 'name', trim(p_name), 'quantity', p_quantity, 'unit', p_unit,
        'catalogue_number', saved_catalogue_number, 'previous_catalogue_number', item_row.catalogue_number,
        'previous_quantity', item_row.quantity, 'previous_unit', item_row.unit,
        'manufacturer_supplier', trim(p_manufacturer_supplier), 'previous_manufacturer_supplier', item_row.manufacturer_supplier,
        'container_count', p_container_count, 'previous_container_count', item_row.container_count,
        'container_size', p_container_size, 'previous_container_size', item_row.container_size,
        'minimum_containers', p_minimum_containers, 'previous_minimum_containers', item_row.minimum_containers,
        'minimum_quantity', p_minimum_quantity, 'previous_minimum_quantity', item_row.minimum_quantity));
  return saved_id;
exception when unique_violation then
  get stacked diagnostics violated_constraint = constraint_name;
  if violated_constraint = 'inventory_items_lab_catalogue_number_key' then
    raise exception 'This Catalogue Number already belongs to a product in this lab. Search inventory, including archived products, and edit that entry instead.';
  end if;
  raise;
end;
$$;

drop function public.request_quantity_change(uuid, numeric, text, integer, text);

create function public.request_quantity_change(p_item_id uuid, p_quantity numeric, p_unit text,
  p_version integer, p_reason text default null, p_container_count numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item_row public.inventory_items; request_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into item_row from public.inventory_items where id = p_item_id for update;
  if not found or not private.is_member(item_row.lab_id) or item_row.archived then raise exception 'Active membership required.'; end if;
  if item_row.version is distinct from p_version then raise exception 'This product changed. Refresh and try again.'; end if;
  if item_row.manufacturer_supplier is null or item_row.container_count is null or item_row.container_size is null then
    raise exception 'Ask the lab to complete Manufacturer/Supplier and container details first.';
  end if;
  if p_unit is distinct from item_row.unit then raise exception 'Use the product measurement unit. Only the lab may change it.'; end if;
  if p_container_count is null then raise exception 'Container count is required.'; end if;
  if p_quantity > p_container_count * item_row.container_size then raise exception 'Remaining quantity cannot exceed the combined container capacity.'; end if;
  update public.quantity_requests set status = 'stale', decided_at = now(), response = 'Product changed. Please resubmit.'
    where item_id = p_item_id and student_id = auth.uid() and status = 'pending' and base_version <> item_row.version;
  insert into public.quantity_requests(lab_id, item_id, item_name, student_id, quantity, unit, base_version, reason, container_count)
    values(item_row.lab_id, p_item_id, item_row.name, auth.uid(), p_quantity, p_unit, p_version, nullif(trim(p_reason), ''), p_container_count)
    returning id into request_id;
  return request_id;
end;
$$;

create or replace function public.decide_quantity_change(p_request_id uuid, p_approve boolean, p_response text default null)
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
  elsif item_row.archived or item_row.version <> request_row.base_version or request_row.container_count is null
    or request_row.unit is distinct from item_row.unit or item_row.container_size is null then
    result_status := 'stale';
  elsif p_approve then
    result_status := 'approved';
    update public.inventory_items set quantity = request_row.quantity, container_count = request_row.container_count,
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
        'container_count', request_row.container_count, 'previous_container_count', item_row.container_count,
        'previous_quantity', item_row.quantity, 'previous_unit', item_row.unit));
  return result_status;
end;
$$;

revoke execute on function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text, text, numeric, numeric, numeric, numeric),
  public.request_quantity_change(uuid, numeric, text, integer, text, numeric), public.decide_quantity_change(uuid, boolean, text) from public, anon;
grant execute on function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text, text, numeric, numeric, numeric, numeric),
  public.request_quantity_change(uuid, numeric, text, integer, text, numeric), public.decide_quantity_change(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;
