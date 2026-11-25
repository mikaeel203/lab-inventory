begin;

create function public.delete_inventory_item(p_item_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare item_row public.inventory_items;
begin
  select * into item_row from public.inventory_items where id = p_item_id for update;
  if not found or not private.is_owner(item_row.lab_id) then raise exception 'Lab owner access required.'; end if;
  if p_version is distinct from item_row.version then raise exception 'This product changed. Close this dialog and review the latest product before deleting.'; end if;
  insert into public.audit_events(lab_id, actor_id, action, details)
    values(item_row.lab_id, auth.uid(), 'product.deleted',
      jsonb_build_object('item_id', item_row.id, 'name', item_row.name, 'quantity', item_row.quantity,
        'unit', item_row.unit, 'product', to_jsonb(item_row)));
  delete from public.inventory_items where id = p_item_id;
end;
$$;

revoke execute on function public.delete_inventory_item(uuid, integer) from public, anon;
grant execute on function public.delete_inventory_item(uuid, integer) to authenticated;

do $$
declare table_name text;
begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array['memberships', 'join_requests', 'quantity_requests', 'inventory_items', 'audit_events'] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
