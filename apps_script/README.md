# Phone quote maker — one-time setup (~10 min on a computer)

This puts a "Make Quote" web page inside your Google Sheet. After setup you use
it entirely from your phone — no app to install, **no API key, no per-quote
cost**. You fill a short form (brand, thickness, size, sheets, rate) and it makes
the quote and PDF. Do these steps once on a Windows/Mac computer in Chrome.

## What you'll need
- The quotation Google Sheet (with the `QUOTATIONS`, `claude landscape`,
  `claude portrait`, `landscape`, `portrait` tabs).

## Steps

1. **Open the sheet** on the computer → **Extensions → Apps Script**.

2. **Paste the code.** In `Code.gs`, select all, delete, and paste the contents
   of `apps_script/Code.gs`. Save (💾).

3. **Add the page.** Click **＋ → HTML**. Name it exactly `Index`. Delete its
   default content and paste the contents of `apps_script/Index.html`. Save.

4. **Deploy as a web app.** **Deploy → New deployment** → gear → **Web app**:
   - Execute as: **Me**
   - Who has access: **Only myself**

   Click **Deploy**.

5. **Allow permissions.** Authorize when asked (edit the sheet, create Drive
   files, send email as you). If it warns "unverified app", that's normal for
   your own script: **Advanced → Go to … (unsafe) → Allow**.

6. **Copy the Web app URL.** Open it **on your phone**, signed in to the **same
   Google account**, and **Add to Home screen**. That icon is your quote maker.

## Using it on your phone
- **New quote:** type the customer name. For each glass item pick the **brand**
  from the dropdown and type **thickness, sheets, length, breadth, rate**. Tap
  **+ Add item** for more items. Tap **Preview**, check it, then **Confirm &
  save + PDF**. It's added to `QUOTATIONS` and the PDF is emailed to you and
  saved to a Drive folder "Rachna Quotes". Landscape for ≤ 8 items, portrait for
  more.
- **Re-print an old quote:** type its number under "Re-print an old quote" → **Get PDF**.

## Rates
Type the rate on each item line. To avoid retyping common rates, make a tab named
`Rates` with columns `brand | thickness | rate | gst` (one row per glass type) —
those fill in automatically when you leave an item's Rate box blank. A rate typed
on the item always wins.

## After changing the code
If you update `Code.gs`/`Index.html`: **Deploy → Manage deployments →** pencil →
**Version: New version → Deploy**. Same URL keeps working.

## Notes
- The new-quote PDF comes from the `claude landscape`/`claude portrait` tabs, so
  those must show the most recent quote. Re-prints come from `landscape`/
  `portrait`, which fetch the number from cell **H4**.
- Everything is free — Google charges nothing for this.
