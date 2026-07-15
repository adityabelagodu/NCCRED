# Making the queued Tally bills — instructions for Claude on the OFFICE computer

SAVE THIS FILE ONCE on the office computer (e.g. Desktop\tally_bills.md) with
`<API_URL>` replaced by the "Anyone"-access deployment URL and `<KEY>` by the
`TALLY_API_KEY` value set in Code.gs. After that, billing needs no typing of
links or keys — just tell Claude "make the queued Tally bills" and point it at
this file (or keep it in Claude's project so it's always loaded).

---

You are on the office computer where TallyPrime is running. Bills to be made in
Tally are queued by my phone quote app. Process them now:

1. **Fetch the queue.** GET this URL (it returns JSON):
   `<API_URL>?tally=pending&key=<KEY>`
   Each bill has: `row` (queue row id), `quote`, `customer`, `address`, `gstin`,
   `godown`, `copies`, `saveToDocuments`, `einvoice`, `vehicle`, `destination`,
   `items[]` (per line: `is_charge`, `brand`, `thickness` mm, `length` cm,
   `breadth` cm, `sheets`, `rate` per mm incl. GST, or for loading/transport
   lines `m2` and `rate_m2` pretax, plus `description`), and
   `totals` (`taxable`, `cgst`, `sgst`, `total`).

2. **Create each bill in TallyPrime** as a Sales voucher, by POSTing Tally XML
   to `http://localhost:9000` (TallyPrime must show acting as Both/Server —
   F1 Help → Settings → Connectivity). For each bill:
   - Party ledger = `customer` (names match Tally — the app's customer list was
     exported from Tally). Use `gstin`/`address` to double-check the party.
   - Inventory lines: one per glass item. Quantity in m² =
     `length/100 × breadth/100 × sheets`; rate per m² (pretax) =
     `thickness × rate × 0.84746`. Allocate ALL inventory to godown `godown`.
   - The app's brand codes (e.g. "sg", "asahi mirror") may not exactly match
     the TallyPrime stock item names — the first few times, show me your
     proposed stock-item match for each line and let me confirm before posting.
     Keep a mapping table so later bills need no confirmation.
   - `is_charge` lines (loading/transport) are NOT inventory: put them on the
     Loading/Transport ledger, amount = `m2 × rate_m2`.
   - GST: CGST 9% + SGST 9% on the taxable value; the expected `totals` are in
     the payload — verify the voucher total matches `totals.total` (±1 rupee
     rounding) before accepting it.
   - Narration: include quote number, and vehicle/destination if present.

3. **E-invoice gate — the strict rule:**
   - If `einvoice` is **true** (B2B): generate the e-invoice for the voucher in
     TallyPrime (send it to the IRP and confirm the **IRN and QR code are on
     the voucher**). Print and save **ONLY after** the e-invoice exists. If
     e-invoice generation fails for any reason, do **NOT** print and do **NOT**
     save to Documents — mark the bill ERROR (step 6) with the reason.
   - If `einvoice` is **false** (B2C): no e-invoice is needed — go straight to
     printing/saving.

4. **Print** `copies` copies of the invoice (skip printing if `copies` is 0).

5. **If `saveToDocuments` is true**, save/export the invoice PDF into my
   Documents folder as `Bill_<quote>_<customer>.pdf`.

6. **Mark it done** so my phone shows DONE:
   `<API_URL>?tally=done&key=<KEY>&row=<row>`
   If a bill failed (including a failed e-invoice), instead call it with
   `&status=ERROR&note=<short reason>` and tell me what went wrong.

7. Repeat for every pending bill, then give me a one-line summary per bill
   (voucher number, e-invoice IRN status, printed, saved).
