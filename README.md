# DDS Marine — Dashboard (self-hosted)

A small Node/Express app with three modules — **Payslips**, **Invoices** and
**Archive** — all with DDS branding, all downloadable as PDF, all archived to
Google Drive via `rclone`. Staff and client data live in JSON files on your VPS.

---

## 1. What's in this folder

```
server.js               Express server (API + serves the frontend)
package.json
.env.example             Copy to .env and fill in real values
public/
  index.html              Dashboard home (live counts + links to each module)
  payslip.html             Payslip generator (staff, EPF/SOCSO/EIS calc)
  invoice.html             Invoice generator (clients, line items)
  archive.html             Browse/search everything archived, reopen PDFs
  pdf-docs.js              Draws the payslip + invoice as vector PDFs
  assets/dds-logo.png       Full logo + tagline (used on invoices)
  assets/dds-logo-mark.png  Diamond mark only (used in small circular badges)
  vendor/                   jsPDF, vendored (see vendor/README.md)
test/api.test.js          API tests — run with `npm test`
data/                     employees.json, clients.json, company.json,
                           invoice_settings.json, payslips.json, invoices.json
                           (all auto-created on first run)
pdfs/
  payslips/                Generated payslip PDFs land here
  invoices/                 Generated invoice PDFs land here
                           — this whole pdfs/ tree is what rclone syncs to Drive
```

**Where PDFs are stored:** clicking "Save to Archive" on either a payslip or
an invoice uploads the generated PDF to the server, which writes it to
`pdfs/payslips/` or `pdfs/invoices/` respectively. "Download PDF" is separate
— that one only saves to your own device and never touches the server.

**PDFs are vector.** Both documents are generated as true vector PDFs: the
text is real text (selectable, searchable) and the rules, tables and logo are
vector shapes. That means you can open a downloaded or archived PDF in Adobe
Illustrator or any PDF editor and edit it — retype a line, nudge the layout,
recolour the logo — without it turning into a blurry image. Files are around
12-15 KB each.

**Browsing what you've archived:** the **Archive** page (`/archive.html`, also
linked from the dashboard) lists every payslip and invoice that was saved,
newest first, with a search box. "View PDF" opens the server's copy — the same
file rclone syncs to Drive. Each payslip row shows its gross and net pay, and
each invoice row can be **duplicated**: that reopens the invoice page with the
same client, line items and notes pre-filled under a fresh invoice number,
which saves retyping recurring jobs.

**Re-archiving is a replace, not a duplicate.** Saving the same staff member's
same pay month, or the same invoice number, twice overwrites the earlier PDF
and updates that archive entry in place rather than leaving a stale copy
behind. The button says "Archive updated ✓" instead of "Saved to Archive ✓"
when that happens.

**Invoice numbering:** the "Invoice #" field is pre-filled with (highest
number seen so far + 1), but it's just a suggestion — fully editable, so
skipping numbers (e.g. going from 73 to 80 because other invoices exist
outside this tool) works fine.

**Removing staff or clients:** open the profile ("Edit staff profile" /
"Edit client") and use the delete link at the bottom of the form. Anything
already archived for them is deliberately kept — deleting someone from the
list never removes historical payslips or invoices.

---

## 1a. Running the tests

```bash
npm install
npm test
```

This boots the server against a throwaway data directory (so your real
`data/` and `pdfs/` are untouched) and checks the API end to end: auth, staff
and client CRUD, archiving, PDF round-trips, invoice numbering, and that a
malicious invoice number can't write outside `pdfs/`. Worth running before
deploying a change.

---

## 2. Deploying with Coolify (recommended if you already run Coolify)

Coolify already gives you a reverse proxy and automatic HTTPS (via Traefik +
Let's Encrypt), so this is simpler than a manual VPS setup — you don't need
Nginx, Certbot, or pm2 at all. Two things matter more here than usual:
**persistent volumes** and **domain**.

**1. Push this code to a Git repo.** Coolify deploys from Git. Create a new
repo (GitHub/GitLab, public or private) and push everything in this folder,
including the `Dockerfile` and `.gitignore` — both are already set up for
this. `.gitignore` deliberately excludes `data/*.json` and `pdfs/**/*.pdf`
so no real staff/client data ends up in the repo; the app recreates those
files with safe defaults on first run.

**2. In Coolify: New Resource → Application → your Git repo.** Coolify
should detect the `Dockerfile` automatically (Build Pack: Dockerfile). Set
the exposed port to `3300` in the app's General settings.

**3. Environment variables** (Coolify's "Environment Variables" tab):
```
ADMIN_USER=admin
ADMIN_PASS=<something strong>
```

**4. Persistent storage — do this before your first real deploy.** In the
app's "Storages" tab, add two volume mounts so a redeploy doesn't wipe
everything:
```
Container path: /app/data     →  a named volume, e.g. dds-dashboard-data
Container path: /app/pdfs     →  a named volume, e.g. dds-dashboard-pdfs
```
Without this, every redeploy resets staff/client lists and clears the PDF
archive, because Coolify rebuilds the container fresh each time.

**5. Domain.** Since you don't have a domain yet, use the free
[sslip.io](https://sslip.io) trick: find your Oracle VPS's public IP (say
`165.22.10.5`) and enter `165-22-10-5.sslip.io` as the app's domain in
Coolify. Coolify's built-in Traefik will request a real Let's Encrypt
certificate for it automatically — no extra setup. You'll then reach the
dashboard at `https://165-22-10-5.sslip.io`.

**6. Deploy.** Click Deploy in Coolify and watch the build log. Once it's
up, visit the domain from step 5 — your browser should prompt for the
ADMIN_USER/ADMIN_PASS you set.

**Oracle Cloud gotcha:** Oracle VPS instances have *two* layers of
firewall — the OS-level one (which Coolify usually configures for you) and
Oracle's own cloud-level "Security List" / Network Security Group, which
blocks ports by default regardless of the OS firewall. If the domain
doesn't load after deploying, check that ports 80 and 443 are allowed as
ingress rules in your Oracle Cloud console under your VCN's Security List
— this is the single most common reason a Coolify app doesn't load
externally on Oracle.

**Connecting rclone for Drive sync:** the `pdfs/` folder now lives inside
a Docker volume rather than a plain folder, so point rclone at its actual
location on the host instead of a path like `~/dds-dashboard-app/pdfs`.
Find it with:
```bash
docker volume inspect dds-dashboard-pdfs
```
Look for `"Mountpoint"` in the output (typically something like
`/var/lib/docker/volumes/dds-dashboard-pdfs/_data`) and use that path in
the `rclone sync` command and cron job from Section 6 (rclone) below — same idea, just point it at the Docker volume path instead.

If you'd rather deploy the traditional way (no Coolify) — e.g. on a second
plain VPS — Section 3 below covers that from scratch.

---

## 3. Manual VPS setup (skip this if using Coolify above)

Requires Node.js 18+ (check with `node -v`).

```bash
# unzip this folder on your VPS, then:
cd dds-dashboard-app
npm install
cp .env.example .env
nano .env        # set ADMIN_USER and ADMIN_PASS to something strong
node server.js    # quick test — visit http://your-vps-ip:3300
```

You should see a login prompt from your browser (HTTP Basic Auth) before the
dashboard loads — one login protects both Payslips and Invoices. If you don't
set ADMIN_USER/ADMIN_PASS in `.env`, the server starts anyway but prints a
warning — **don't leave it exposed like that.**

Stop the test run with Ctrl+C once you've confirmed it works.

---

## 4. Keep it running (pm2)

```bash
npm install -g pm2
pm2 start server.js --name dds-dashboard
pm2 save
pm2 startup   # follow the printed instruction to enable on-boot start
```

Useful commands: `pm2 logs dds-dashboard`, `pm2 restart dds-dashboard`.

---

## 5. Put it behind HTTPS (strongly recommended)

HTTP Basic Auth sends your password with every request — fine over HTTPS,
not fine in plain HTTP. If you have a domain pointed at the VPS, the simplest
path is Nginx + Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

Nginx site config (`/etc/nginx/sites-available/dds-dashboard`):

```nginx
server {
    listen 80;
    server_name dashboard.yourdomain.com;

    location / {
        proxy_pass http://localhost:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dds-dashboard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dashboard.yourdomain.com
```

If you don't have a spare domain, at minimum restrict the port with your
firewall (e.g. `ufw allow from <your-office-ip> to any port 3300`) rather
than leaving 3300 open to the world.

---

## 6. Sync the `pdfs/` folder to Google Drive with rclone

One-time setup. rclone runs independently of the app — the app never talks
to Google directly, it just writes files to `pdfs/payslips/` and
`pdfs/invoices/`.

**Install rclone:**
```bash
sudo -v && curl https://rclone.org/install.sh | sudo bash
```

**Authorize your Google account.** Your VPS has no browser, so do the
OAuth step on your own laptop and paste the result into the VPS:

```bash
# on the VPS:
rclone config
# choose: n (new remote) → name it "gdrive" → type: drive
# scope: 1 (full access)
# for "Use auto config?" answer: n   (since the VPS has no browser)
# it will print a command like:
#   rclone authorize "drive"
# → copy that command, run it on your OWN laptop (where you have a browser),
#   sign in to the Google account you want to use, then paste the long
#   token it prints back into the VPS prompt.
```

Create a folder in Google Drive (e.g. "DDS Dashboard Archive") and confirm rclone can see it:

```bash
rclone lsd gdrive:
```

**One-off manual sync test** (syncs both payslips/ and invoices/ subfolders at once):
```bash
rclone sync ~/dds-dashboard-app/pdfs "gdrive:DDS Dashboard Archive" --progress
```

Drive will end up with the same `payslips/` and `invoices/` subfolder
structure as the VPS — everything stays organized automatically.

**Automate it with cron** (runs every 5 minutes):
```bash
crontab -e
```
Add this line (adjust the path to match your actual install location):
```
*/5 * * * * /usr/bin/rclone sync /home/youruser/dds-dashboard-app/pdfs "gdrive:DDS Dashboard Archive" >> /home/youruser/rclone-sync.log 2>&1
```

From then on, any PDF saved via "Save to Archive" appears in Drive within
about 5 minutes, with no further action needed.

---

## 7. Backups

The real "database" here is everything in `data/` — tiny JSON files, worth
including in whatever backup routine you already have for the VPS (or just
periodically copy the `data/` folder somewhere safe). PDFs are backed up
automatically once they're in Drive.

---

## 8. Notes on the numbers

**Payslips** — EPF: 11% employee / 13% (wage ≤ RM5,000) or 12% (> RM5,000)
employer. SOCSO: ~0.5% employee / ~1.75% employer, capped at RM6,000. EIS:
0.2% / 0.2%, also capped at RM6,000. These are flat percentages, not the
official KWSP/PERKESO rounding tables — close enough for a handful of staff,
but cross-check the official tables if a figure needs to be exact. PCB /
income tax is **not** calculated.

**Invoices** — no SST applied (Total = Subtotal); Amount Due always equals
Total since payment status isn't tracked here (track that separately).
Currency is MYR throughout.

---

## 9. Day-to-day use

**Payslips:** Dashboard → Payslips → add each staff member once (salary,
bank, EPF/SOCSO numbers) → each month, click their name, fill in that
month's allowances/OT/commission → Generate → Download (to send) → Save to
Archive (to keep a copy in Drive).

**Invoices:** Dashboard → Invoices → add each client once (name, address,
email) → for each invoice, click the client, set the invoice number/date/
line items → Generate → Download (to send) → Save to Archive (to keep a
copy in Drive).

**Recurring invoices:** Dashboard → Archive → Invoices tab → **Duplicate** on
a past invoice. Everything except the invoice number and dates comes across,
so a repeat job for the same vessel is a couple of clicks.

**Finding an old document:** Dashboard → Archive, then search by staff name,
month, client, or invoice number.

All modules share one login and one Drive sync — nothing extra to set up
per module.

---

## 10. Notes for whoever maintains this

**No internet needed to make a PDF.** `html2canvas` and `jsPDF` are vendored
in `public/vendor/` rather than loaded from a CDN, so PDF generation keeps
working if the office connection drops. See `public/vendor/README.md` before
changing their versions — they control what the printed document looks like.

**PDFs are true vector, and editable.** `public/pdf-docs.js` draws the payslip
and the invoice with jsPDF's native primitives — real text, real lines, real
filled shapes — so the exported file opens in Adobe Illustrator or any PDF
editor with every element individually selectable and editable, and the text
is searchable and copyable. Files come out around 12-15 KB.

The catch to know about: **the on-screen preview and the PDF are two separate
layouts of the same document.** The preview is the HTML in `payslip.html` /
`invoice.html`; the PDF is the drawing code in `pdf-docs.js`. They're built to
match, but changing one does not change the other — edit both, then
regenerate a document and compare.

Fonts are jsPDF's built-in Helvetica, one of the 14 standard PDF fonts, so
nothing is embedded and files stay small. A PDF editor may substitute a local
equivalent (usually Arial) when you edit; the text stays fully editable either
way. The DDS diamond mark is drawn as vector paths rather than placed as the
PNG, so it stays crisp at any zoom and can be recoloured in Illustrator.

**Storage paths are configurable.** `DDS_DATA_DIR` and `DDS_PDF_DIR` override
where the JSON files and PDFs live, if you'd rather mount volumes somewhere
other than `/app/data` and `/app/pdfs`.

**The JSON files are the database.** They're written with a temp-file-plus-
rename so an unlucky crash or power cut can't leave a half-written file that
the app then can't read. Back up `data/` (Section 7).
