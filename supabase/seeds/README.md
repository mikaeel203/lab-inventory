# Optional starter product references

Run `starter_catalogue.sql` as `postgres` in the Supabase SQL Editor **after** applying migrations through `202611260003_catalogue_autofill.sql`. This is a separate, optional import, not an inventory migration. It is not automatically executed by `supabase db push`.

The seed contains 25 public product references, checked against the official supplier pages linked in each record on November 26, 2026. Only names, suppliers, catalogue numbers, package capacities, measurement units, public product-page URLs and explicit identifier mappings are included. No source lab, account, institution, project, original document, price, planned order, stock count, remaining amount or threshold is imported.

The public `product_url` in every seed record is its verification source. Sizes refer to the selected supplier package, not the amount remaining in a lab. Suggestions must still be checked against the physical label, especially grade, concentration and package size. Supplier product pages and availability can change. This starter set is intentionally incomplete; uncertain identities and packages are omitted rather than guessed.

## Identifiers

- Canonical supplier numbers are text, not numbers. Explicit alternatives such as `1.00983` → `100983` and `8.14733` → `814733` are stored in `product_catalogue_aliases`.
- These are curated mappings, not general punctuation removal. Leading zeros, unrelated dotted identifiers, Excel floating-point artifacts, CAS numbers, RRIDs, serial numbers and batch numbers are not automatically rewritten.
- Pack-specific ordering numbers are aliases only where the public source identifies the specific package. They do not manufacture a barcode association.
- Three package-specific GTINs are taken from the supplier pages' listed GTIN tables:

| Product | Package | Exact GTIN | Public source |
| --- | --- | --- | --- |
| 822283 | 5 L | `04022536944210` | https://www.merckmillipore.com/DE/de/product/Methanol%2CMDA_CHEM-8222835000 |
| 100312 | 2.5 L | `04022536004266` | https://www.merckmillipore.com/INTL/en/product/Hydrochloric-acid-250-0%2CMDA_CHEM-1003122500 |
| E5134 | 1 kg | `04061835544516` | https://www.sigmaaldrich.com/US/en/product/sigma/e5134?context=pro |

Scanners may emit different symbologies or representations. Only these exact values are mapped; label testing is still needed. No EAN/UPC/GS1 transformations or extraction of GS1 application identifiers are implemented.

An exact known public product URL can resolve a QR scan without a network request to the supplier. It returns all known packages for that URL, requiring selection if ambiguous. Registered package-specific code mappings take precedence. Regional URLs, redirects, shortened links, links with tracking parameters and unknown codes are not guessed to be equivalent; existing online metadata/manual fallback remains available.

## Import safety

The import is transactional and repeat-safe. Equivalent measurement units are matched using the existing normalized product identity. Existing product details and codes are never overwritten. Conflicting names/URLs cause that reference's aliases and codes to be skipped, with a notice. A code already assigned elsewhere stays assigned there, also with a notice. Review notices before relying on a newly imported reference. Alternative suppliers/package sizes remain separate candidates, never silently merged.

The alias table has RLS and no direct access for anonymous or authenticated clients. Authenticated users with profiles resolve aliases through the existing restricted lookup RPC. Only trusted administration manages seed aliases. Existing owner-confirmed catalogue contributions and student approval rules remain unchanged.

Before publishing any additional references, verify the supplier's public product name, manufacturer, ordering identifier, exact size/unit, and any code-to-package mapping. Do not derive a reusable code from a filename or assume a generic chemical name specifies the right hydrate, grade or concentration.

## Reviewed expansion: 61 additional references

`catalogue_expansion.sql` includes seven previously reviewed product-package references and 54 subsequently checked antibody references. All 56 Jackson ImmunoResearch records were checked against fresh official public product panels using an independent parser for product identity, host, target, specificity, conjugate, antibody format, cross-reactivity qualifiers and package. The five Sigma Aldrich records retain their separately reviewed product/package evidence. Shared records contain public reference facts only, not research logs or private source-document associations.

| Primary supplier website | Starter | Expansion | Combined |
| --- | ---: | ---: | ---: |
| Sigma-Aldrich | 22 | 5 | 27 |
| Merck Millipore | 3 | 0 | 3 |
| Jackson ImmunoResearch | 0 | 56 | 56 |
| **Total product-package references** | **25** | **61** | **86** |

These are unique package-reference counts, not distinct chemical-name counts or current hosted database totals. Other existing catalogue contributions are preserved. Five expansion references originated in the reviewed source list and 56 are additional discoveries/variants; origin and website counts overlap, not add together.

The expansion supplies five exact package aliases: `N6876-1G`, `N6876-500MG`, `N6876-5G`, `Z628026-100EA`, and `SAB5700639-100UL`. The three N6876 sizes share one product-page URL, so generic `N6876` entry or that URL requires choosing a package. Verified GTINs bind each size separately:

| Product | Package | GTIN |
| --- | --- | --- |
| N6876 | 1 g | `04061835573592` |
| N6876 | 500 mg | `04061835573615` |
| N6876 | 5 g | `04061835573622` |

The exact package/GTIN join is documented by the official supplier at https://www.sigmaaldrich.com/IT/it/product/sial/n6876; the public product reference uses its reviewed VE page. The combined seeds contain **six verified code mappings**. There are no newly invented barcode mappings for the Jackson products. All 86 references support their exact catalogue identifiers; recognized public URLs also support lookup, but arbitrary QR, GS1 and label barcodes are not guaranteed to resolve. No physical-camera testing is claimed.

One antibody package discrepancy remains excluded rather than silently changing the requested package. No stock amounts, pricing, accounts, labs or audit history are imported. Historical source/raw/review files remain private and are not needed to execute this public-facts-only SQL.

### Correction of unsupported historical aliases

The older starter seed included `T-1503`, `E-5134` and `A-2383` as alternate numbers. The review found support for canonical `T1503`, `E5134` and `A2383`, but not for those exact hyphenated spellings. The starter seed now omits them. The expansion removes these three mappings **only** when attached to the original supplier, canonical identifier and normalized mass package. Unrelated suppliers, sizes, aliases, product rows, confirmed codes and lab inventory are not changed. This is removal of unsupported suggestions, not a claim that a legacy identifier can never exist.

### Update an existing hosted database before pushing

1. Open the correct Supabase project, then **SQL Editor → New query**. Use the administrator `postgres` role, keep RLS enabled, and use the project's normal backup procedure before changing production data.
2. Confirm pending schema migrations. A read-only check is:

   ```sql
   select
     to_regclass('public.product_catalogue') as product_catalogue,
     to_regclass('public.product_catalogue_aliases') as catalogue_aliases,
     to_regclass('public.product_requests') as student_product_requests,
     to_regprocedure('public.lookup_product_catalogue(text,text,text)') as catalogue_lookup;
   ```

   Missing objects mean setup is incomplete. Apply only migrations not previously applied, in filename order through `202611260003_catalogue_autofill.sql`. The pending student-product migration is `202611260002_student_product_requests.sql`. Do not rerun schema migrations or recreate tables that are already installed. See the main README for earlier dependencies. If objects appear partially installed, investigate the failed migration rather than guessing from table counts.
3. In a new query, paste and run the **entire contents** of the current `starter_catalogue.sql`. This is safe even if the original 25 records were previously imported; it does not reset the catalogue or overwrite existing details.
4. In a separate new query, paste and run the **entire contents** of `catalogue_expansion.sql`. Do not paste the filename or `:1` editor line suffix. This applies the narrowly scoped alias correction and reviewed additions in one transaction. Read notices for conflicting references or code mappings; they are preserved and require review, not forced overwrites.
5. Check the result:

   ```sql
   select
     (select count(*) from public.product_catalogue) as product_references,
     (select count(*) from public.product_catalogue_aliases) as catalogue_aliases,
     (select count(*) from public.product_catalogue_codes) as reusable_codes;

   select catalogue_number, manufacturer_supplier, container_size, unit
   from public.product_catalogue
   where catalogue_number in ('N6876', '115-005-205', '115-035-205', '715-165-140')
   order by catalogue_number, container_size;
   ```

   With only these seeds and no conflicts, expect **86 products, 15 aliases, six codes**. Existing confirmed contributions can increase counts; a count alone is not proof that every incoming mapping was accepted. The sample should include three N6876 packages and the different mg/mL antibody package types.
6. In the app, enter `115-005-205`, `115-035-205`, `N6876-1G` and `N6876`. Check product details and explicit package selection. Enter lab stock manually. Test actual labels separately; manual code entry is not a camera test.

Both seed files are independently repeat-safe. Running the corrected starter again will not restore the unsupported aliases. The expansion also works without the starter, adding its own 61 references, but running both yields the documented complete set. No new schema migration is needed beyond the existing pending files. Git push/deployment does not execute these SQL files, and running these files does not push or deploy application code.
