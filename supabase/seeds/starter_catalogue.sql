begin;

do $$
declare
  reference record;
  saved_product public.product_catalogue;
  alias_value text;
  code_value text;
  mapped_product uuid;
  added integer := 0;
  skipped integer := 0;
  inserted_count integer;
begin
  for reference in select * from jsonb_to_recordset($products$[
    {"name":"Methanol","supplier":"Merck","catalogue":"822283","size":5,"unit":"L","url":"https://www.merckmillipore.com/DE/de/product/Methanol%2CMDA_CHEM-8222835000","aliases":["8222835000"],"codes":["04022536944210"]},
    {"name":"Poly(vinyl alcohol), Mw 85,000–124,000, 87–89% hydrolyzed","supplier":"Sigma Aldrich","catalogue":"363081","size":25,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/aldrich/363081"},
    {"name":"2-Propanol, BioReagent","supplier":"Sigma Aldrich","catalogue":"I9516","size":500,"unit":"mL","url":"https://www.sigmaaldrich.com/US/en/product/sigma/i9516"},
    {"name":"Salicylic acid, ACS reagent","supplier":"Sigma Aldrich","catalogue":"247588","size":500,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sial/247588"},
    {"name":"Oil Red O, powder","supplier":"Sigma Aldrich","catalogue":"O0625","size":100,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sial/o0625"},
    {"name":"β-Nicotinamide adenine dinucleotide, reduced disodium salt hydrate (NADH)","supplier":"Sigma Aldrich","catalogue":"N8129","size":500,"unit":"mg","url":"https://www.sigmaaldrich.com/US/en/product/sigma/n8129"},
    {"name":"MOPS","supplier":"Sigma Aldrich","catalogue":"M1254","size":25,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/m1254"},
    {"name":"Ethanol absolute, for analysis EMSURE","supplier":"Merck","catalogue":"100983","size":2.5,"unit":"L","url":"https://www.sigmaaldrich.com/US/en/product/mm/100983","aliases":["1.00983","1009832500"]},
    {"name":"Acetic acid, glacial, ACS reagent","supplier":"Sigma Aldrich","catalogue":"695092","size":2.5,"unit":"L","url":"https://www.sigmaaldrich.com/US/en/product/sigald/695092"},
    {"name":"Hydrochloric acid 25%","supplier":"Merck","catalogue":"100312","size":2.5,"unit":"L","url":"https://www.merckmillipore.com/INTL/en/product/Hydrochloric-acid-250-0%2CMDA_CHEM-1003122500","aliases":["1.00312","1003122500"],"codes":["04022536004266"]},
    {"name":"Trizma base","supplier":"Sigma Aldrich","catalogue":"T1503","size":1,"unit":"kg","url":"https://www.sigmaaldrich.com/US/en/product/sigma/t1503"},
    {"name":"Ethylenediaminetetraacetic acid disodium salt dihydrate (EDTA)","supplier":"Sigma Aldrich","catalogue":"E5134","size":1,"unit":"kg","url":"https://www.sigmaaldrich.com/US/en/product/sigma/e5134","codes":["04061835544516"]},
    {"name":"Potassium hydroxide pellets, for analysis EMSURE","supplier":"Merck","catalogue":"105033","size":500,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/mm/105033","aliases":["1.05033"]},
    {"name":"Sodium hydroxide pellets, for analysis EMSURE","supplier":"Merck","catalogue":"106498","size":500,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/mm/106498","aliases":["1.06498"]},
    {"name":"Magnesium chloride, anhydrous, for synthesis","supplier":"Merck","catalogue":"814733","size":100,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/mm/814733","aliases":["8.14733"]},
    {"name":"Adenosine 5′-triphosphate disodium salt hydrate (ATP)","supplier":"Sigma Aldrich","catalogue":"A2383","size":10,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/a2383"},
    {"name":"Glycine, for analysis","supplier":"Merck","catalogue":"104201","size":1,"unit":"kg","url":"https://www.merckmillipore.com/GB/en/product/Glycine%2CMDA_CHEM-104201","aliases":["1.04201","1042011000"]},
    {"name":"Acrylamide, for electrophoresis","supplier":"Sigma Aldrich","catalogue":"A8887","size":1,"unit":"kg","url":"https://www.sigmaaldrich.com/US/en/product/sigma/a8887"},
    {"name":"N,N′-Methylenebis(acrylamide)","supplier":"Sigma Aldrich","catalogue":"146072","size":500,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sial/146072"},
    {"name":"Ammonium persulfate, for electrophoresis","supplier":"Sigma Aldrich","catalogue":"A3678","size":25,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/a3678"},
    {"name":"Magnesium acetate tetrahydrate","supplier":"Sigma Aldrich","catalogue":"M5661","size":50,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/m5661"},
    {"name":"D-(+)-Glucose, BioXtra","supplier":"Sigma Aldrich","catalogue":"G7528","size":250,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/g7528"},
    {"name":"Adenosine 5′-diphosphate sodium salt (ADP)","supplier":"Sigma Aldrich","catalogue":"A2754","size":100,"unit":"mg","url":"https://www.sigmaaldrich.com/US/en/product/sigma/a2754"},
    {"name":"Adenosine 5′-monophosphate sodium salt (AMP)","supplier":"Sigma Aldrich","catalogue":"A1752","size":1,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sigma/a1752"},
    {"name":"N-Acetyl-L-cysteine","supplier":"Sigma Aldrich","catalogue":"A7250","size":5,"unit":"g","url":"https://www.sigmaaldrich.com/US/en/product/sial/a7250"}
  ]$products$::jsonb) as products(name text, supplier text, catalogue text, size numeric, unit text, url text, aliases text[], codes text[])
  loop
    insert into public.product_catalogue(name, manufacturer_supplier, catalogue_number, container_size, unit, product_url)
      values(reference.name, reference.supplier, reference.catalogue, reference.size, reference.unit, reference.url)
      on conflict do nothing;
    get diagnostics inserted_count = row_count;
    added := added + inserted_count;
    select * into saved_product from public.product_catalogue
      where lower(manufacturer_supplier) = lower(reference.supplier) and lower(catalogue_number) = lower(reference.catalogue)
        and (case when unit in ('L', 'mL', 'µL') then 'volume' when unit in ('kg', 'g', 'mg') then 'mass' else 'count' end)
          = (case when reference.unit in ('L', 'mL', 'µL') then 'volume' when reference.unit in ('kg', 'g', 'mg') then 'mass' else 'count' end)
        and container_size * case when unit in ('L', 'kg') then 1000000 when unit in ('mL', 'g') then 1000 else 1 end
          = reference.size * case when reference.unit in ('L', 'kg') then 1000000 when reference.unit in ('mL', 'g') then 1000 else 1 end
      for update;
    if lower(saved_product.name) <> lower(reference.name) or saved_product.product_url is distinct from reference.url then
      skipped := skipped + 1;
      raise notice 'Existing reference differs for % / %. Details and mappings left untouched.', reference.supplier, reference.catalogue;
      continue;
    end if;
    foreach alias_value in array coalesce(reference.aliases, array[]::text[]) loop
      insert into public.product_catalogue_aliases(catalogue_number, product_id) values(alias_value, saved_product.id) on conflict do nothing;
    end loop;
    foreach code_value in array coalesce(reference.codes, array[]::text[]) loop
      insert into public.product_catalogue_codes(code, product_id) values(code_value, saved_product.id) on conflict do nothing;
      select product_id into mapped_product from public.product_catalogue_codes where code = code_value;
      if mapped_product <> saved_product.id then
        raise notice 'Code % already belongs to another product; mapping left untouched.', code_value;
      end if;
    end loop;
  end loop;
  raise notice 'Starter catalogue: % new products, % conflicting existing references skipped. No lab inventory changed.', added, skipped;
end;
$$;

commit;
