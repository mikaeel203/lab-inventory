begin;

create table public.product_catalogue (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 180 and name = trim(name) and name !~ '[[:cntrl:]]'),
  manufacturer_supplier text not null check (length(manufacturer_supplier) between 1 and 180 and manufacturer_supplier = trim(manufacturer_supplier) and manufacturer_supplier !~ '[[:cntrl:]]'),
  catalogue_number text not null check (length(catalogue_number) between 1 and 120 and catalogue_number = trim(catalogue_number) and catalogue_number !~ '[[:cntrl:]]'),
  container_size numeric not null check (container_size > 0 and container_size <= 1000000000000),
  unit text not null check (unit in ('L', 'mL', 'µL', 'kg', 'g', 'mg', 'count')),
  product_url text check (length(product_url) <= 2048 and product_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(/[A-Za-z0-9._~!$&()*+,;=:%/-]*)?$'),
  check (unit <> 'count' or container_size = trunc(container_size))
);

create unique index product_catalogue_identity on public.product_catalogue (
  lower(manufacturer_supplier), lower(catalogue_number),
  (case when unit in ('L', 'mL', 'µL') then 'volume' when unit in ('kg', 'g', 'mg') then 'mass' else 'count' end),
  (container_size * case when unit in ('L', 'kg') then 1000000 when unit in ('mL', 'g') then 1000 else 1 end)
);
create index product_catalogue_number_lookup on public.product_catalogue(lower(catalogue_number));

create table public.product_catalogue_codes (
  code text primary key check (length(code) between 1 and 2048 and code = trim(code) and code !~ '[[:cntrl:]]'),
  product_id uuid not null references public.product_catalogue(id) on delete cascade
);
create index product_catalogue_codes_product on public.product_catalogue_codes(product_id);

alter table public.product_catalogue enable row level security;
alter table public.product_catalogue_codes enable row level security;
revoke all on public.product_catalogue, public.product_catalogue_codes from public, anon, authenticated;
grant select on public.product_catalogue to authenticated;
create policy product_catalogue_read on public.product_catalogue for select to authenticated
  using (exists(select 1 from public.profiles where id = auth.uid()));

create function public.lookup_product_catalogue(p_code text default null, p_catalogue_number text default null, p_manufacturer_supplier text default null)
returns setof public.product_catalogue language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = auth.uid()) then raise exception 'Sign in to look up products.'; end if;
  if length(p_code) > 2048 or length(p_catalogue_number) > 120 or length(p_manufacturer_supplier) > 180 then raise exception 'Lookup value is too long.'; end if;
  if nullif(trim(p_code), '') is not null then
    return query select product.* from public.product_catalogue product
      join public.product_catalogue_codes codes on codes.product_id = product.id where codes.code = trim(p_code);
  elsif nullif(trim(p_catalogue_number), '') is not null then
    return query select product.* from public.product_catalogue product
      where lower(product.catalogue_number) = lower(trim(p_catalogue_number))
        and (nullif(trim(p_manufacturer_supplier), '') is null or lower(product.manufacturer_supplier) = lower(trim(p_manufacturer_supplier)))
      order by product.manufacturer_supplier, product.unit, product.container_size, product.id limit 21;
  end if;
end;
$$;

create function public.save_catalogued_inventory_item(p_lab_id uuid, p_name text, p_quantity numeric, p_unit text,
  p_barcode text default null, p_barcode_format text default null, p_product_url text default null,
  p_item_id uuid default null, p_version integer default null, p_catalogue_number text default null,
  p_manufacturer_supplier text default null, p_container_count numeric default null, p_container_size numeric default null,
  p_minimum_containers numeric default null, p_minimum_quantity numeric default null,
  p_confirm_product boolean default false, p_confirm_code boolean default false, p_confirm_url boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
  product_row public.product_catalogue;
  canonical_size numeric;
  canonical_category text;
  saved_code text := nullif(trim(p_barcode), '');
  saved_url text := case when p_confirm_url then nullif(trim(p_product_url), '') else null end;
  code_product uuid;
begin
  if not private.is_owner(p_lab_id) then raise exception 'Lab owner access required.'; end if;
  if p_confirm_product is distinct from true then raise exception 'Confirm the printed product details before remembering them in the shared catalogue.'; end if;
  if nullif(trim(p_catalogue_number), '') is null then raise exception 'A Catalogue Number is required for the shared catalogue.'; end if;
  if p_confirm_code and saved_code is null then raise exception 'Enter a reusable product barcode or QR value before confirming it.'; end if;
  if p_confirm_url and saved_url is null then raise exception 'Enter a public product link before confirming it.'; end if;
  if p_confirm_code and saved_code ~* '^https?://' and saved_code !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(/[A-Za-z0-9._~!$&()*+,;=:%/-]*)?$' then
    raise exception 'Only plain public HTTPS product links without query strings, fragments or credentials can be remembered as QR values.';
  end if;
  if saved_url is not null and saved_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(/[A-Za-z0-9._~!$&()*+,;=:%/-]*)?$' then
    raise exception 'Only plain public HTTPS product links without query strings, fragments or credentials can be remembered.';
  end if;

  saved_id := public.save_inventory_item(p_lab_id, p_name, p_quantity, p_unit, p_barcode, p_barcode_format, p_product_url,
    p_item_id, p_version, p_catalogue_number, p_manufacturer_supplier, p_container_count, p_container_size, p_minimum_containers, p_minimum_quantity);

  canonical_size := p_container_size * case when p_unit in ('L', 'kg') then 1000000 when p_unit in ('mL', 'g') then 1000 else 1 end;
  canonical_category := case when p_unit in ('L', 'mL', 'µL') then 'volume' when p_unit in ('kg', 'g', 'mg') then 'mass' else 'count' end;
  insert into public.product_catalogue(name, manufacturer_supplier, catalogue_number, container_size, unit, product_url)
    values(trim(p_name), trim(p_manufacturer_supplier), trim(p_catalogue_number), p_container_size, p_unit, saved_url)
    on conflict do nothing;
  select * into product_row from public.product_catalogue
    where lower(manufacturer_supplier) = lower(trim(p_manufacturer_supplier)) and lower(catalogue_number) = lower(trim(p_catalogue_number))
      and (case when unit in ('L', 'mL', 'µL') then 'volume' when unit in ('kg', 'g', 'mg') then 'mass' else 'count' end) = canonical_category
      and container_size * case when unit in ('L', 'kg') then 1000000 when unit in ('mL', 'g') then 1000 else 1 end = canonical_size for update;
  if lower(product_row.name) <> lower(trim(p_name)) or (saved_url is not null and product_row.product_url is not null and saved_url <> product_row.product_url) then
    raise exception 'The shared catalogue has different details for this product. Nothing was saved. Review the label or uncheck catalogue confirmation to save only to your lab. Existing catalogue details were not overwritten.';
  end if;
  if saved_url is not null and product_row.product_url is null then
    update public.product_catalogue set product_url = saved_url where id = product_row.id;
  end if;
  if p_confirm_code then
    insert into public.product_catalogue_codes(code, product_id) values(saved_code, product_row.id) on conflict do nothing;
    select product_id into code_product from public.product_catalogue_codes where code = saved_code;
    if code_product <> product_row.id then
      raise exception 'This code already identifies a different catalogue product. Nothing was saved. Review it or uncheck code confirmation to keep the code only in your lab.';
    end if;
  end if;
  return saved_id;
end;
$$;

revoke execute on function public.lookup_product_catalogue(text, text, text),
  public.save_catalogued_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text, text, numeric, numeric, numeric, numeric, boolean, boolean, boolean) from public, anon;
grant execute on function public.lookup_product_catalogue(text, text, text),
  public.save_catalogued_inventory_item(uuid, text, numeric, text, text, text, text, uuid, integer, text, text, numeric, numeric, numeric, numeric, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
