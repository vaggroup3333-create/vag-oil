# Packaging test release — not published to production

Readiness review, 18 October 2026: numeric steppers hidden globally; corrected standalone test cashier included. All 8 automated test files pass, including draft package edits, unpost/edit/repost, sealed barrel sales, fully paid 600/200/480 scenario, and legacy document preservation. Browser QA remains unverified. A fresh manual production backup is still required immediately before installation; the daily API reuses the same day's existing copy. This candidate is NOT approved for production installation yet. No production records were modified by these checks.

Baseline: production version 40, commit d27ad6ed1174b8b18de99caedd989b05db75169a.
Before work: daily-2026-10-18 backup verified on 18 October 2026; 36 products, 5 documents, 2 photos. No production ledger writes are part of this release.

## Behavior

- Packaging is entered explicitly on a purchase row for a product already accounted in fractional litres. Canister/barrel volume (up to 3 decimal places), integer pack count, and per-pack price derive the canonical quantity and litre price. Existing piece-counted products are not converted automatically.
- Drafts do not create inventory. Posting creates sealed packaging lots and adds litres once. Existing product identity, article and prior inventory remain intact; purchase retail/wholesale values retain existing defaults.
- Cashier/director sales select bulk litres or an available sealed package size. Sealed sales consume only matching sealed stock. Bulk sales use unallocated old litres, opened containers, then open the oldest closed containers automatically. Each product still uses the existing single row per document; use separate documents for different modes/sizes of the same product.
- Product weighted-average cost remains authoritative. Discounts and delivery costs feed that cost, and existing profit reports consume the resulting sale costs. The pack price is divided without rounding prematurely to cents per litre.
- Client returns are loose/open by default. An explicit sealed checkbox restores only whole sealed packages from a sealed sale. Supplier returns of packaged receipts require intact whole packages. Rollback/delete/restore preserves packaging inventory and existing dependency checks.
- Cashier snapshots and offline actions carry packaging data. Server validation remains authoritative; stock conflicts remain pending for review. Package data contains no supplier costs.
- The new stock section shows sealed count/volume, remaining litres in opened containers, and old/unallocated litres separately. No automatic assumptions are made about physical packaging of old stock.

## Verification

Run `node --test tests/*.test.mjs`, `node node_modules/typescript/bin/tsc --noEmit` and the standard Sites build.
New tests cover 5L canisters, 200L barrels, decimal pricing, opening, shortage, sealed/open returns, drafts, rollback, deleting/restoring, old stock, inventory/writeoff, weighted profit, and offline package preservation.

Build a standalone synthetic-data exercise with `node scripts/build-packaging-lab.mjs /absolute/path/VAG_Oil_packaging_test.html`. It bundles the actual ledger, packaging controls and cashier. CSP blocks network connections; data are held only in page memory and reset on refresh. It is a test exercise, not a production database backup or installable full VAG Oil release.

Scenario: purchase 2 × 5L for 300 TJS each; sell 2L for 100/L; sell one sealed 5L for 480. Expect 3L in one opened canister, revenue 680, cost 420, profit 260. Confirm mobile/desktop interaction manually before any production deployment. No hosted browser QA was performed in this environment.

Do not deploy this candidate without review of the test result. Runtime data/schema migration is not needed: new packaging fields are optional and introduced only by explicit new operations.

## Follow-up review after version 42 — 18 October 2026

Fixed a cashier UI pricing defect: switching between bulk and sealed packaging now keeps the current per-litre price, including wholesale, manually negotiated and zero prices, instead of resetting to retail. A test invokes the actual React select handler for both directions and verifies purchase pricing remains unchanged. Both desktop and mobile use this component.

Read-only production export at 13:21:39 UTC matched the 13:09 export in every data field (45 working products, 3 documents, version 376); only export timestamp differs. Draft 000002 retains all 42 lines. The manual backup created 13:09:55 UTC was verified again at 13:21:09 UTC: both ledgers together contain 46 products, 5 documents and 2 photos. No restore or business-data writes were performed.

Browser QA remains blocked for the candidate: the official editor preview iframe points to the production URL, not an isolated candidate. Sites current_preview_url is null. No test transactions were made on production. The managed preview requires unavailable control-browser tooling, so no alternate server or browser was launched. Desktop/mobile candidate interaction and visual numeric spinner checks remain unverified. Do not publish until these checks pass and the owner gives final permission; refresh data comparison and backup immediately before installation.

## Purchase form discoverability fix after 43

Move packaging inputs from the product-name table cell into a dedicated section in the actual purchase draft form. Show explicit guidance when no litre product has been added, a warning instead of silent hiding for litre cards restricted to whole quantities, and a product-card hint explaining that packaging is configured in a receipt. Explicit unit selection also sets the matching whole-quantity flag; existing cards are not migrated. Tests render the real shared panel and invoke its barrel selection handler with synthetic data. Backup regression assertion compares database rows, excluding nondeterministic query timing metadata.

Pre-change backup manual-bd0fe775-b723-41e4-976c-a48ebd0e5244 verified 13:51 UTC: 45 working + 1 demo products, 3 working + 2 demo documents, 2 photos. The exact new name “масло 5W40” was not present in either exported ledger; supplied screenshot shows an unsaved New Product dialog. Do not claim that this unsaved card is backed up or recreate it automatically.
