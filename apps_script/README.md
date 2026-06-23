# Phone quote maker — one-time setup (~15 min on a computer)

This puts a "Make Quote" web page inside your Google Sheet. After setup you use
it entirely from your phone — no computer, no app to install. Do these steps once
on a Windows/Mac computer in Chrome.

## What you'll need
- The quotation Google Sheet (the one with the `QUOTATIONS`, `claude landscape`,
  `claude portrait`, `landscape`, `portrait` tabs).
- Your Anthropic API key (from console.anthropic.com → API Keys).

## Steps

1. **Open the sheet** on the computer, then click **Extensions → Apps Script**.
   A code editor opens in a new tab.

2. **Paste the code.** In the editor you'll see a file `Code.gs` with a few
   default lines. Select all, delete, and paste the entire contents of
   `apps_script/Code.gs` from this project.

3. **Add the page.** Click the **+** next to "Files" → **HTML**. Name it exactly
   `Index` (it becomes `Index.html`). Delete its default content and paste the
   entire contents of `apps_script/Index.html`.

4. **Add your API key.** Click the **gear icon (Project Settings)** on the left →
   scroll to **Script Properties** → **Add script property**:
   - Property: `ANTHROPIC_API_KEY`
   - Value: your key (starts with `sk-ant-`)
   - **Save script properties**.

5. **Deploy as a web app.** Top-right **Deploy → New deployment** →
   click the gear → **Web app**. Set:
   - Description: `Rachna Quote`
   - Execute as: **Me**
   - Who has access: **Only myself**

   Click **Deploy**.

6. **Allow permissions.** Google asks you to authorize (edit the sheet, create
   Drive files, send email on your behalf, connect to the Anthropic service).
   Click through **Allow**. (If it warns the app is "unverified", that's normal
   for your own script — choose Advanced → "Go to … (unsafe)" → Allow. It's your
   own code, only you can use it.)

7. **Copy the Web app URL** it shows. Open that URL **on your phone**, sign in
   with the **same Google account**, and add it to your home screen
   (browser menu → "Add to Home screen"). That's your quote button.

## Using it on your phone

- **New quote:** type the customer name, type or voice-type what they want
  ("4mm SG 244x138 25 sheets"), put the rate in the Rate box (`sg, 4, 110`), tap
  **Preview**, check it, tap **Confirm & save + PDF**. The quote is added to
  `QUOTATIONS` and the PDF is emailed to you and saved in a Drive folder
  "Rachna Quotes". Landscape for ≤ 8 items, portrait for more.
- **Re-print an old quote:** type its number under "Re-print an old quote" and
  tap **Get PDF**.

## Rates
Enter the rate in the Rate box each time, **or** make a tab named `Rates` with
columns `brand | thickness | rate | gst` (one row per glass type) and it'll be
used automatically — the Rate box overrides it for that quote.

## After changing the code
If you ever update `Code.gs`/`Index.html`: **Deploy → Manage deployments →**
edit (pencil) → **Version: New version → Deploy**. The same URL keeps working.

## Notes
- The new-quote PDF comes from the `claude landscape`/`claude portrait` tabs, so
  those must show the most recent quote. Re-prints come from `landscape`/
  `portrait`, which fetch the number from cell **H4**.
- Each quote uses a small amount of Anthropic API credit. Google is free.
- This is the same logic as the Python tool in this repo, for when you have a PC.
