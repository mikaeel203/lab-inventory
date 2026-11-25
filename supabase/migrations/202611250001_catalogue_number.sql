begin;

alter table public.inventory_items add column catalogue_number text
  check (catalogue_number is null or (
    length(catalogue_number) between 1 and 120
    and catalogue_number = trim(catalogue_number)
    and catalogue_number !~ '[[:cntrl:]]'
  ));

create unique index inventory_items_lab_catalogue_number_key
  on public.inventory_items(lab_id, lower(catalogue_number))
  where catalogue_number is not null;

drop function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer);

create function public.save_inventory_item(p_lab_id uuid, p_name text, p_quantity numeric, p_unit text,
  p_barcode text default null, p_barcode_format text default null, p_product_url text default null,
  p_item_id uuid default null, p_version integer default null, p_catalogue_number text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  item_row public.inventory_items;
  saved_id uuid;
  violated_constraint text;
  saved_catalogue_number text := nullif(trim(p_catalogue_number), '');
begin
  if not private.is_owner(p_lab_id) then raise exception 'Lab owner access required.'; end if;
  if p_item_id is null then
    insert into public.inventory_items(lab_id, name, quantity, unit, barcode, barcode_format, product_url, catalogue_number)
    values(p_lab_id, trim(p_name), p_quantity, p_unit, nullif(trim(p_barcode), ''),
      nullif(trim(p_barcode_format), ''), nullif(trim(p_product_url), ''), saved_catalogue_number) returning id into saved_id;
  else
    select * into item_row from public.inventory_items where id = p_item_id and lab_id = p_lab_id for update;
    if not found then raise exception 'Product not found.'; end if;
    if p_version is distinct from item_row.version then raise exception 'This product changed. Refresh and try again.'; end if;
    if p_catalogue_number is null then saved_catalogue_number := item_row.catalogue_number; end if;
    update public.inventory_items set name = trim(p_name), quantity = p_quantity, unit = p_unit,
      barcode = nullif(trim(p_barcode), ''), barcode_format = nullif(trim(p_barcode_format), ''),
      catalogue_number = saved_catalogue_number,
      product_url = nullif(trim(p_product_url), ''), archived = false, version = version + 1, updated_at = now()
      where id = p_item_id returning id into saved_id;
  end if;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(p_lab_id, auth.uid(), case when p_item_id is null then 'product.created' else 'product.updated' end,
      jsonb_build_object('item_id', saved_id, 'name', trim(p_name), 'quantity', p_quantity, 'unit', p_unit,
        'catalogue_number', saved_catalogue_number, 'previous_catalogue_number', item_row.catalogue_number,
        'previous_quantity', item_row.quantity, 'previous_unit', item_row.unit));
  return saved_id;
exception when unique_violation then
  get stacked diagnostics violated_constraint = constraint_name;
  if violated_constraint = 'inventory_items_lab_catalogue_number_key' then
    raise exception 'This Catalogue Number already belongs to a product in this lab. Search inventory, including archived products, and edit that entry instead.';
  end if;
  raise;
end;
$$;

revoke execute on function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text) from public, anon;
grant execute on function public.save_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
commit;
