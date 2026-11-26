begin;

create table public.product_catalogue_aliases (
  catalogue_number text not null check (length(catalogue_number) between 1 and 120 and catalogue_number = trim(catalogue_number) and catalogue_number !~ '[[:cntrl:]]'),
  product_id uuid not null references public.product_catalogue(id) on delete cascade
);
create unique index product_catalogue_alias_identity on public.product_catalogue_aliases(lower(catalogue_number), product_id);
create index product_catalogue_alias_product on public.product_catalogue_aliases(product_id);
create index product_catalogue_url_lookup on public.product_catalogue(product_url) where product_url is not null;
alter table public.product_catalogue_aliases enable row level security;
revoke all on public.product_catalogue_aliases from public, anon, authenticated;

create or replace function public.lookup_product_catalogue(p_code text default null, p_catalogue_number text default null, p_manufacturer_supplier text default null)
returns setof public.product_catalogue language plpgsql security definer set search_path = '' as $$
declare
  lookup_number text := nullif(trim(p_catalogue_number), '');
  lookup_code text := nullif(trim(p_code), '');
begin
  if not exists(select 1 from public.profiles where id = auth.uid()) then raise exception 'Sign in to look up products.'; end if;
  if length(p_code) > 2048 or length(p_catalogue_number) > 120 or length(p_manufacturer_supplier) > 180 then raise exception 'Lookup value is too long.'; end if;
  if lookup_code is not null then
    return query select product.* from public.product_catalogue product
      join public.product_catalogue_codes codes on codes.product_id = product.id where codes.code = lookup_code;
    if found then return; end if;
    if lookup_code ~* '^https?://' then
      return query select product.* from public.product_catalogue product where product.product_url = lookup_code
        order by product.manufacturer_supplier, product.unit, product.container_size, product.id limit 21;
      return;
    end if;
    lookup_number := lookup_code;
  end if;
  if lookup_number is not null then
    return query select product.* from public.product_catalogue product
      where (lower(product.catalogue_number) = lower(lookup_number)
        or exists(select 1 from public.product_catalogue_aliases aliases
          where aliases.product_id = product.id and lower(aliases.catalogue_number) = lower(lookup_number)))
        and (nullif(trim(p_manufacturer_supplier), '') is null or lower(product.manufacturer_supplier) = lower(trim(p_manufacturer_supplier)))
      order by product.manufacturer_supplier, product.unit, product.container_size, product.id limit 21;
  end if;
end;
$$;

revoke execute on function public.lookup_product_catalogue(text, text, text) from public, anon;
grant execute on function public.lookup_product_catalogue(text, text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
