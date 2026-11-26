# BenchMark

A mobile-first lab inventory app built with Next.js, React, and Supabase. It includes real authentication integration, PostgreSQL permissions, camera scanning, product totals, approval workflows, and a responsive interface. Without backend credentials it displays a setup screen, not a simulated inventory.

## Start locally

Use **Linux Node.js 22+ (Node.js 24 LTS recommended)** inside Ubuntu/WSL, not Windows `npm` through the WSL path. The project includes a dependency lockfile.

```bash
cd ~/Development/projects/lab_inventory
npm ci
cp .env.example .env.local
```

Create a Supabase project, follow the database/auth steps below, and fill in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Use the project's **publishable key**, not its secret/service-role key. The application does not need privileged database credentials.

```bash
npm run dev
```

Open `http://localhost:3000`. The server binds to all interfaces, but **camera access on a phone requires HTTPS**; plain HTTP to a LAN IP is not sufficient. Use an HTTPS deployment or a trusted development HTTPS endpoint. No changes to Windows/WSL networking are performed automatically.

For a development tunnel, also add its exact hostname to `allowedDevOrigins` in `next.config.ts` and restart the dev server. Do not add a broad wildcard. This restriction does not affect a production deployment.

## Set up Supabase

1. In the SQL editor of a **new, dedicated project**, execute each file in `supabase/migrations` once in filename order: `202611240001_initial.sql`, `202611250001_catalogue_number.sql`, `202611250002_stock_tracking.sql`, `202611250003_live_updates_and_delete.sql`, `202611260001_shared_product_catalogue.sql`, `202611260002_student_product_requests.sql`, then `202611260003_catalogue_autofill.sql`. Alternatively, link the project using the Supabase CLI and apply migrations with `supabase db push`.
2. Keep the `private` schema outside the API's exposed schemas. Public table writes are intentionally disallowed, including for lab owners; all changes use transactional RPCs.
3. Enable email/password authentication and **Confirm email**. Set the minimum password length to **12**. Configure production SMTP before inviting real users.
4. Set **Site URL** to the application origin, initially `http://localhost:3000`. Add `http://localhost:3000/auth/confirm` to allowed redirect URLs. Add the exact HTTPS production callback before deployment; avoid wildcard production redirects.
5. For **Confirm signup**, set the subject to **Confirm your email | BenchMark** and replace the complete HTML email body with `supabase/templates/confirm-signup.html`.
6. For **Reset password**, set the subject to **Reset your password | BenchMark** and replace the complete HTML email body with `supabase/templates/reset-password.html`.

These branded, mobile-friendly templates use the website's green/cream palette and preserve the required token-hash callback links. See `supabase/templates/README.md` for exact installation and testing steps. They must be saved in the hosted Supabase email-template editor; changing local HTML files alone does not update sent emails. Keep your existing SMTP configuration. No database migration is required.

The app supplies `/auth/confirm` as the redirect for both flows. This handler exchanges the token for a cookie-backed session; recovery opens the new-password form. Existing users created before this migration will not automatically gain profiles—use a fresh project or provision those profiles deliberately.

## Upgrading an existing installation to BenchMark

Apply only migrations you have not already run, in filename order, as `postgres` in Supabase's SQL Editor. If the shared catalogue is already installed, run `supabase/migrations/202611260002_student_product_requests.sql` (unless already applied), followed by `supabase/migrations/202611260003_catalogue_autofill.sql`. Do not rerun earlier migrations or recreate your database. Restart or redeploy the app afterwards.

### Catalogue-first entry and starter references

Catalogue Number is the first field in the product editor. When adding a product, typing pauses for 600 ms before checking the lab and shared catalogue automatically. **Find saved product** also performs the lookup immediately. Existing inventory edits do not trigger automatic replacement. Changing the identifier clears untouched suggestions, preserves manual edits, and discards stale responses. Known aliases resolve to the canonical catalogue number; uncertain supplier/package matches require an explicit choice. Stock totals and number of units are never imported or inferred.

To load the optional starter catalogue into an existing installation:

1. Apply the pending schema migrations described above, keeping RLS enabled.
2. Open **Supabase → SQL Editor → New query**. Copy the **entire contents** of `supabase/seeds/starter_catalogue.sql`, select the `postgres` role, and click **Run**.
3. Check the query's notices for skipped conflicting references. This imports **25 product references**, verified public identifier aliases, and **three package-specific GTINs**, not lab inventory. It is safe to run the seed again: existing details and code mappings are never overwritten. Schema migrations are still applied only once.
4. Restart the local app (or deploy when ready). Add a product and type `T1503`, `1.00983`, or `O0625`. Review the suggested specifications and supply the actual lab stock.

The optional seed is **not run by `supabase db push`**. Public source links and coverage limitations are documented in `supabase/seeds/README.md`. Known exact public product URLs can resolve QR scans to the catalogue; package-specific code mappings take precedence. A generic product URL can cover multiple sizes and is not proof of the scanned pack size. Unknown QR/GTIN values still need lookup or manual confirmation. No barcode values are guessed from catalogue numbers, and there is no blanket removal of punctuation or leading zeros.

The reviewed expansion in `supabase/seeds/catalogue_expansion.sql` adds **61 more product-package references**, for **86** across both supplied seeds, plus five verified package aliases and three additional GTINs. Run it as a separate SQL Editor query after the schema and starter seed. It also removes only three unsupported historical alias mappings (`T-1503`, `E-5134`, `A-2383`) for their exact seeded Sigma Aldrich packages; canonical numbers and inventory remain unchanged. The starter seed no longer reinserts those aliases. Both imports are repeat-safe and preserve conflicting existing references. Full instructions and verification queries are in `supabase/seeds/README.md`. These data imports are independent of a Git push or deployment.

### Student product submissions

Copy the entire `supabase/migrations/202611260002_student_product_requests.sql` file into **Supabase → SQL Editor → New query** and click **Run**, keeping RLS enabled. Apply the earlier shared-catalogue migration first if it is not installed. Existing inventory and request history are preserved; this migration adds a separate pending-product table, restricted request/decision functions and its Realtime publication entry.

Approved students can use **Add manually** or **Scan product** in their currently selected lab. They enter or look up the product name, Manufacturer/Supplier, Catalogue Number, code/link, number of units, amount per unit and total remaining quantity, then choose **Submit product for approval**. They can add a note but cannot set lab stock thresholds or publish catalogue records. Students without active membership cannot submit products. Scanning an existing active product opens the quantity-change request instead.

**Requests → New products** lists each submission with its full proposed details. Only that lab's owner can approve or reject, with an optional response. Approval creates a new inventory item atomically with the decision; rejection leaves stock unchanged. Approval does **not** publish the product to the shared catalogue: the owner can subsequently edit the saved item and explicitly verify its public label details. All new-product, quantity and membership requests contribute to the pending count. The usual Realtime/polling refresh updates both sessions without a manual reload.

Students can see their own request status and withdraw a pending product through an in-app confirmation popup, then resubmit corrected details. Other students and unrelated labs cannot see their proposals. Leaving or losing lab membership cancels outstanding product and quantity requests for that lab, but not their requests to another lab. A student retains their own submission history after leaving.

Duplicate barcodes or catalogue numbers already in that lab (including archives) cannot become new products. A duplicate that appears after submission makes approval stale without adding stock; review the existing entry instead. Concurrent conflicting inserts still obey the inventory uniqueness constraints and roll back on conflict. Repeated approval cannot add the same request twice. Without a barcode or catalogue number there is no reliable automatic duplicate identification; the owner must review the name, supplier and package details. No stock is automatically merged.

### Shared product catalogue

Copy the entire `supabase/migrations/202611260001_shared_product_catalogue.sql` file into **Supabase → SQL Editor → New query**, then click **Run**. Keep RLS enabled. The migration adds catalogue tables and restricted lookup/save functions; it preserves existing inventory and does not copy historical records into the catalogue.

The catalogue is a reusable product reference for **all labs**, not shared inventory. It contains only product name, Manufacturer/Supplier, Catalogue Number, package size and measurement unit, an optional confirmed public product link, and separately confirmed reusable barcode/QR aliases. Shared records contain no contributing lab/account identifiers, source timestamps, stock counts, remaining quantities, thresholds, memberships or requests. Inventory and its audit history remain lab-private. Authenticated users with a profile can look up product details, including students who cannot yet access a lab's inventory.

When saving a product, a lab owner can confirm that its details were checked against the printed public label. This confirmation starts unchecked; suggestions are not automatically published. Separate confirmations are required for reusable codes and public links. Never confirm internal asset codes, batch-specific identifiers, lab nicknames or private URLs. Shared links and HTTP(S) QR values must be plain HTTPS product URLs without query strings, fragments or credentials. These checks cannot establish that a page or code is genuinely public: the owner's label verification is essential.

Lookup checks the current lab first, then the shared catalogue. A shared match fills product specifications only; the lab must enter its own number of units and total remaining amount. Multiple supplier/package matches require selection. Recognized aliases reopen an existing matching lab entry instead of adding stock. If a URL code has no catalogue match, the existing product-page metadata lookup runs; unknown numeric codes and unavailable lookups allow manual entry. There is no generic online catalogue-number search. Choose **Code type → Catalogue number** to type a printed number, or type it in the editor for automatic lookup. Photo/OCR reading is not implemented yet.

Shared identity includes Manufacturer/Supplier, Catalogue Number and normalized package capacity/category. Equivalent sizes such as 1 L and 1000 mL match; catalogue punctuation and leading zeros are retained. Existing per-lab catalogue-number uniqueness is unchanged, so separate suppliers or package sizes with the same number cannot yet be separate entries in one lab without qualified identifiers.

Conflicting confirmed names, links or code mappings never overwrite the existing reference. The entire save rolls back, and the owner can review the label or remove catalogue/code confirmation to save the inventory privately. There is no in-app catalogue correction/review queue yet; corrections require trusted database administration. Catalogue references persist independently after local inventory edits, deletion or deletion of the contributing account, and they never silently change another lab's saved inventory. A full disposable-test reset must explicitly clear `product_catalogue_aliases`, `product_catalogue_codes` and `product_catalogue` as well as lab/account tables; deleting accounts alone does not clear this reference data.

### Live updates, deletion and confirmation emails

Copy the entire `supabase/migrations/202611250003_live_updates_and_delete.sql` file into **Supabase → SQL Editor → New query**, then click **Run**. This enables the workspace tables in the `supabase_realtime` publication and adds the owner-only delete RPC. Existing records and RLS permissions are preserved. It does not delete anything merely by being applied.

Workspace changes trigger an authenticated, RLS-checked refresh via Realtime insert/update notifications. A five-second visible-page polling fallback catches missed events, membership revocations, archives and deletions, including when Realtime is unavailable. Returning to a tab or reconnecting also refreshes it. Refreshes do not replace an open editor's unsaved input; stale saves still require review. Background refreshes avoid overlapping writes or other refreshes. Both devices must be online; background browser tabs catch up when made visible.

Archive, leave-lab and remove-access confirmations now use in-app dialogs instead of native browser confirmations. Owners also have a **Delete** button for active and archived products. Permanent deletion requires an explicit confirmation, removes associated quantity requests, and retains a product snapshot in the audit history. It checks the product version before deleting; use Archive instead for reversible removal.

After signup, **Resend confirmation email** becomes available after a 60-second countdown. It sends only when clicked, uses the original signup address and callback, and starts another cooldown after each attempt. Signup and password-reset notices remind users to check spam/junk. A failed login due to an unconfirmed email also offers resend. SMTP delivery failures and server rate limits are shown rather than reported as success. These controls do not change your hosted SMTP credentials, email template or callback settings. A lab and a separate student account need different email addresses.

Duplicate signup for an existing verified account displays **“An account with this email already exists. Sign in or reset your password instead.”**, with **Sign in instead** and **Reset password** actions that retain the email address. It handles explicit duplicate-signup errors and Supabase's successful obfuscated-user response with an empty identities array and no session, instead of claiming a confirmation email was sent. Existing unverified accounts keep the confirmation/resend flow so they can finish verification. Missing identity information is not treated as proof of an existing account. Editing the email clears stale messages and confirmation controls. This change needs no additional database migration or privileged credentials; it uses the signup response rather than adding a public account-search endpoint. The explicit message reveals account existence in these recognized duplicate cases, as intended by the app's signup UX.

The UI calls package counts **Number of units**, with **Amount per unit** and **Minimum units**. Existing database column names remain unchanged so no stock data needs to be rewritten.

### Stock tracking upgrade

Open `supabase/migrations/202611250002_stock_tracking.sql`, copy the **entire file**, then in your Supabase project open **SQL Editor → New query**, paste it, and click **Run**. Leave the app's RLS policies enabled; this migration retains them and its restricted write functions.

Existing products, accounts, memberships, quantities, catalogue numbers and audit history are preserved. Old products show **Stock setup needed** until the lab enters their required Manufacturer/Supplier, unit count and amount per unit on the next edit. Missing historical values stay unknown rather than becoming fabricated supplier names or zero counts. Students cannot submit changes for these products until setup is complete. Pending quantity requests from before this upgrade are marked stale and must be submitted again with a unit count.

For example, enter **2 units**, **2.5 L per unit**, and **3.8 L total remaining**. The remaining total can account for partial units but cannot exceed their combined capacity. Unit counts are whole numbers; size must be positive. Zero units requires zero remaining amount. The combined **Manufacturer/Supplier** field is mandatory for all new or saved products, with validation in both the form and database RPC.

Expand **Advanced stock settings** to set minimum units and/or minimum remaining quantity (in the product's unit). Blank disables that check; zero is a valid threshold. A row is **yellow / Low stock** if either enabled threshold is strictly greater than the corresponding current value. Equality is normal. It is **red / Depleted** if units or remaining quantity are zero, regardless of thresholds. Use **Filters & sort → Availability** or sort by **Stock status** (depleted → low → normal; reversible). Status badges also identify the level without relying on colour.

Students request unit-count and remaining-total changes together; the lab approves both atomically. Students cannot alter the supplier, package size, measurement unit or warning thresholds. Owner edits to any of these values increment the version, preventing older proposals from overwriting changed stock settings.

The name is now BenchMark in the interface, browser title, installable-app manifest, and package metadata. The project directory stays `lab_inventory`. Update any Supabase email-template text or sender display name that still says "Lab Inventory" to "BenchMark" separately; those hosted settings are not changed by local code. Keep template token links unchanged. An already installed home-screen shortcut may need to be re-added to display the new name.

Catalogue Number is editable by lab owners and visible/searchable to students. It is optional when unknown and has a 120-character limit. Numbers are stored as text, preserving leading zeros and punctuation, with case-insensitive uniqueness within each lab, including archived products. Different labs may stock the same number. If two suppliers reuse the same number, use a consistent supplier-qualified identifier (for example, `supplier:001-ABC`); the required Manufacturer/Supplier field does not change catalogue-number uniqueness.

URL lookup suggests the single product's structured `sku`, or `mpn` if SKU is absent. Verify it against the label: supplier identifiers are not universally standardized. Multiple-product metadata, unavailable pages, and unidentified numeric barcodes leave the number blank for manual entry. The app does not invent an identifier or treat a barcode, GTIN, CAS number, or batch number as a catalogue number. User edits are not overwritten by a late lookup response. Re-scanning a recorded barcode opens its existing product and catalogue number.

## What is included

- **Lab accounts:** required name, department, and institution; one owner account per lab.
- **Students:** search the authenticated lab directory, request membership, and see no inventory before approval. A first lab requires approval. For a second or later lab, the receiving owner must explicitly acknowledge an existing-membership warning. Approval adds membership without removing earlier memberships. Other lab identities are not disclosed in that warning.
- **Membership administration:** accept/reject requests, optional responses, cancellation by the requester, leaving a lab, and revoking students. Revocation cancels outstanding product and quantity requests.
- **Inventory:** product name, required Manufacturer/Supplier, Catalogue Number, barcode/format, unit count and size, total remaining quantity, unit, optional product URL, stock-warning thresholds, search (including suppliers), filters, sortable lists, editing, archival, and restoration. Units are `L`, `mL`, `µL`, `kg`, `g`, `mg`, and whole-number `count`. Zero remaining stock is valid. Quantity sorting normalizes units within the selected measurement category, not across mass and volume.
- **Camera scanning:** QR, Data Matrix, EAN-13, EAN-8, UPC-A, UPC-E, and Code 128; rear-camera preference and manual fallback. Available to owners and approved students. Repeat scans reuse matching visible products; owners can also reopen archives. Students cannot resubmit archived identifiers as new items. Scans never automatically add stock.
- **Name suggestions:** reuse existing lab entries, then confirmed shared product details; unmatched URL codes try Product JSON-LD and page metadata. Names remain editable. Unknown numeric codes require manual naming; there is no universal barcode catalog or paid lookup provider. No product link is fabricated.
- **Quantity approvals:** students propose a replacement remaining total and unit count, in the product's existing unit, with an optional reason. Only the owning lab can approve. Version checks prevent old requests or edits from overwriting newer inventory; stale requests must be resubmitted.
- **New-product approvals:** students submit manually entered or scanned products; owners review, approve or reject them in Requests. Pending proposals are not inventory, cannot publish to the catalogue, and are visible only to their author and the target lab owner.
- **Activity and inboxes:** in-app request status and the latest 100 audit events; the database retains audit history. Data refreshes through Realtime notifications, on window focus/visibility, reconnection, after writes, and with a five-second visible-page fallback.
- **Home-screen installation:** web manifest, PNG icons, Apple icon, and a network-only service worker. No inventory response is cached by the worker and no writes are queued offline. Browser authentication cookies persist the session; inventory is held only in live application memory.

Remaining amounts represent the **lab-wide total for a product**, separate from the number of units and their full capacity. All units in an entry share one package size. If recording multiple package sizes, use distinct product entries and distinct catalogue identifiers. Owner unit changes do not automatically convert values: update the unit size, remaining total and amount threshold to the new unit together. Different codes are not merged based on matching names. Manually added products without a code can coexist.

## Architecture and security

- `src/app` contains routes, the server-authenticated workspace, auth confirmation, icons/manifest, and the Node.js-only lookup endpoint.
- `src/components` contains the phone-friendly account, inventory, scanning, request, membership, and activity interfaces.
- `supabase/migrations` contains the schema, auth-profile trigger, read policies, and restricted mutation functions. Profile roles cannot be changed by editing auth metadata later.
- All mutation functions validate the caller. Lab IDs or disabled UI buttons are not trusted authorization controls. Membership decisions use a per-student transaction advisory lock; inventory approvals use row locks and optimistic versions. An approval rechecks membership and product state inside its transaction.
- Supplier-page lookup requires an authenticated lab owner or actively approved student and a same-origin POST, with ten attempts per minute per account. The database rechecks eligibility before reserving the lookup. It rejects private/reserved IPs, validates every redirect, pins the resolved public destination while preserving TLS hostname verification, caps page size at 512 KiB, limits redirects, and times out. It never executes supplier scripts. Pages requiring JavaScript, authentication, unusual ports, oversized responses, or anti-bot access fall back to manual entry.
- The lab directory is available to authenticated users only and includes institution/department/name; no inventory or email contacts are published. Institution identity is self-declared, not independently verified.
- React escapes names and fetched metadata. Product links allow only HTTP(S), open separately, and do not receive a referrer. Page/API responses use private/no-store headers. Google Fonts provides optional typography; system fonts remain usable if unavailable.
- The single lab login is an owner account, not an invitation to share credentials. Multiple administrators, verified institutions, attachments, SDS documents, expiry/batch tracking, push alerts, and offline editing are not part of this version.

## Tests

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests exercise quantity rules, filters, metadata parsing, SSRF protections, redirects, DNS pinning, and response limits. Database tests execute the **actual migration** in PGlite (PostgreSQL in-process), switch to the authenticated/anonymous roles, and test RLS, RPC authorization, membership acknowledgement, approvals, stale updates, and revocation.

Browser tests run desktop and phone-sized Chromium against an isolated, loopback-only test backend. That backend executes the actual migration and RPCs in PGlite but simulates the Supabase Auth/PostgREST transport. It is only started by Playwright, uses disposable data, and is never part of the deployed application. The tests exercise signup forms, manual scanning fallback, editable lookup suggestions, inventory changes, student requests, additional-lab warnings, cross-lab product-reference reuse, ambiguous catalogue choices and conflict handling. Catalogue database tests cover the shared-column allowlist, isolated stock, restricted writes, alias mappings, rollback and the absence of historical backfill.

PGlite serializes connections. The concurrent-pending-request test verifies decision-time rechecks but is **not proof of real multi-connection PostgreSQL locking**. Production SMTP, real Supabase sessions, camera hardware, and PostgreSQL concurrency must also be checked in staging.

### Staging acceptance checks

1. Create and verify two lab accounts and one student account through real emails. Test login, logout, expired links, and password recovery from a different browser.
2. Confirm a pending/unaffiliated student cannot read either lab's inventory through UI **or direct API requests**. Confirm one owner cannot edit the other lab's products.
3. Request both labs before either decides; submit both approvals without acknowledgement concurrently. Exactly one succeeds. The other must require acknowledgement. Retry it with acknowledgement and verify both memberships remain.
4. Open the same product in two owner sessions; save in one and verify the other's old version cannot overwrite it. Submit competing student quantity requests; approve concurrently and verify only the current version applies.
5. Revoke a member while a quantity approval is pending; ensure access disappears and the request cannot subsequently apply. Verify requests belonging to a second, still-active lab remain unaffected.
6. On Android Chrome and iPhone Safari over HTTPS, test actual labels for each used barcode format, permission denial, camera release when closing the dialog, manual entry, numeric unknown codes, URL lookup failure, and interrupted connectivity. Autofill is a suggestion, not a chemical identity verification.
7. Install/add to home screen; confirm standalone navigation, sign-out, no private offline inventory cache, and usable layouts at 360px width and with text zoom.
8. Confirm a public product and reusable code in one lab, then scan it in another. Verify only product specifications fill in, stock/threshold fields remain blank and no source lab is shown. Test ambiguous suppliers/package sizes, conflicting confirmations and saving privately after a conflict. Check real label accuracy before confirming; the catalogue is a convenience, not an independent chemical-identity verification service.
9. As a student, submit manual and scanned products; confirm neither enters inventory until its lab approves. Reject and withdraw submissions, test duplicate approvals and identifier conflicts, then revoke membership with pending submissions and an open editor. Verify both sessions update automatically, cancelled requests cannot be approved and unrelated labs/students cannot read the proposals.

## Deployment

Deploy as a Node.js Next.js app (for example, on Vercel), **not a static export**. Choose this directory as the project root, Node.js 24, `npm ci` for installation, and `npm run build` for the build. Set both public Supabase environment variables **before building**; Next.js embeds public values in client bundles. Do not add secret keys to public environment variables.

For a Node.js host:

```bash
npm ci
npm run build
npm start
```

Terminate HTTPS at the hosting platform/reverse proxy, configure the exact production auth callbacks and email templates, and run the staging checklist before handling real lab data. Monitor application errors, failed auth attempts, Supabase database usage, and lookup failures; configure database backups appropriate for the lab. External supplier retrieval requires outbound HTTP(S)/DNS access and gracefully falls back when unavailable.
