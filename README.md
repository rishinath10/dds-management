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
scripts/
  trace-logo.js            Regenerates the vector logo from the artwork
  dds-logo-mark.png        The DDS logo artwork the vector mark is traced from
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

That `pdfs/` folder lives on whatever disk the server runs on — under a
Dokploy or Coolify-style deploy, that means inside the Docker volume you
mounted at `/app/pdfs` (Section 2, step 5), physically on the VPS's disk. **It
is not automatically in Google Drive.** The "→ Drive" part only happens once
`rclone` has been set up separately (Section 6) — a one-time manual step, not
something deploying the app does for you. Until that's done, PDFs exist in
exactly one place: that Docker volume on the VPS. If you're not sure whether
rclone is running yet, check for `rclone sync` in `crontab -l` on the VPS, or
just look in the actual Google Drive folder.

**PDFs are vector.** Both documents are generated as true vector PDFs: the
text is real text (selectable, searchable) and the rules, tables and logo are
vector shapes. That means you can open a downloaded or archived PDF in Adobe
Illustrator or any PDF editor and edit it — retype a line, nudge the layout,
recolour the logo — without it turning into a blurry image. Files are around
12-15 KB each.

**Browsing what you've archived:** the **Archive** page (`/archive.html`, also
linked from the dashboard) lists every payslip and invoice that was saved,
newest first, with a search box. "View PDF" opens the server's own copy —
the same file rclone syncs to Drive, if rclone is set up. Each payslip row
shows its gross and net pay, and each invoice row can be **duplicated**: that
reopens the invoice page with the same client, line items and notes
pre-filled under a fresh invoice number, which saves retyping recurring jobs.

**Deleting an archived payslip or invoice:** each row in the Archive page has
a **Delete** button. This is permanent — it removes the PDF from the server
immediately, and confirms as much before you click through. If rclone is
running, the next sync (every 5 minutes, per the cron job in Section 6)
mirrors that deletion to Google Drive too, since `rclone sync` makes the
Drive folder match the server's exactly. There's no undo and no recycle bin —
if you need to keep a record but stop it cluttering the list, don't delete it.

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

## 2. Deploying with Dokploy (this is what runs ddsmarine.com)

If your Hostinger VPS already runs Dokploy for the main `www.ddsmarine.com`
site, this app becomes a **second, independent Application** on that same
Dokploy instance — same server, same Dokploy panel, own container, own
subdomain. Dokploy's built-in Traefik already terminates HTTPS and routes by
hostname, so it happily runs both sites side by side; you're not choosing
between them.

The two things that matter more than anything else here are the same as any
Docker-based deploy: **persistent volumes** (or a redeploy wipes your staff
list and PDF archive) and **the domain**. Everything below maps onto whatever
your Dokploy version calls these screens — the concepts (Domains, Environment,
Volumes/Mounts) are stable even if a label moved.

**1. Code is already on GitHub and on `main`** — `rishinath10/dds-management`,
branch `main`, with the `Dockerfile` and `.gitignore` already in place.
Nothing to push; Dokploy will pull directly from there.

**2. In Dokploy: create a new Application** (in whichever Project makes
sense — its own, or alongside the main site). Point it at the
`rishinath10/dds-management` GitHub repo, branch `main`. Dokploy should
detect the `Dockerfile` automatically as the build method; if it asks, the
build type is **Dockerfile**, not Nixpacks/buildpacks.

**3. Set the container port to `3300`.** This app listens on port 3300
(see `Dockerfile`'s `EXPOSE 3300`) — wherever Dokploy asks which port the
container exposes internally, that's the number. This is separate from the
public port (443), which Traefik handles.

**4. Environment variables** (the app's Environment/Env Vars tab):
```
ADMIN_USER=admin
ADMIN_PASS=<something strong — this protects staff salary data>
```
This is the only login gate on the whole app (HTTP Basic Auth, see
`server.js`), so don't reuse a weak or shared password here.

**5. Persistent volumes — set this up before the first real deploy, not
after.** Add two mounts so a redeploy doesn't reset everything:
```
Container path: /app/data     →  a named volume, e.g. dds-data
Container path: /app/pdfs     →  a named volume, e.g. dds-pdfs
```
Without this, every redeploy wipes the staff/client lists and clears the
PDF archive, because Dokploy rebuilds the container fresh on each deploy.

**6. Domain: add `admin.ddsmarine.com`** in the Application's Domains tab,
pointed at container port `3300`, with HTTPS/Let's Encrypt enabled. Dokploy's
Traefik will request the certificate automatically once DNS resolves (next
step) — no separate Nginx or Certbot needed.

**7. DNS — one new record.** Since `www.ddsmarine.com` already resolves to
this VPS, you almost certainly just need to add:
```
Type: A
Name: admin
Value: <this VPS's public IP — the same one www.ddsmarine.com points at>
```
wherever `ddsmarine.com`'s DNS is managed (Hostinger's own DNS zone,
Cloudflare, etc. — check `dig www.ddsmarine.com` if unsure which IP). Skip
this step entirely if you already have a wildcard `*.ddsmarine.com` record.
DNS propagation is usually minutes, occasionally longer.

**8. Deploy**, watch the build log, then visit `https://admin.ddsmarine.com`
— your browser should prompt for the ADMIN_USER/ADMIN_PASS from step 4. If
it times out instead of prompting, DNS hasn't propagated yet or the domain
in step 6 doesn't match; if it loads but Traefik can't get a certificate,
double-check ports 80/443 are open on the VPS (they already are, since your
main site uses them — this app doesn't need anything extra there).

**Connecting rclone for Drive sync:** the `pdfs/` folder lives inside a
Docker volume now, not a plain folder, so point rclone at its real location
on the host. Find it with:
```bash
docker volume ls | grep pdfs        # find the actual volume name Dokploy created
docker volume inspect <that-name>   # look for "Mountpoint" in the output
```
Use that `Mountpoint` path (typically something like
`/var/lib/docker/volumes/<name>/_data`) in the `rclone sync` command and
cron job from Section 6 below, in place of a path like
`~/dds-dashboard-app/pdfs`.

If you'd rather deploy the traditional way (no Dokploy) — e.g. on a second
plain VPS — Section 3 below covers that from scratch.

---

## 3. Manual VPS setup (skip this if using Dokploy above)

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
way.

**The logo is vector too.** The DDS mark is drawn as vector paths rather than
placed as the PNG, so it stays crisp at any zoom and can be recoloured or
reshaped in Illustrator. Those paths are traced from the real logo artwork —
the diamond from its measured proportions, the DDS letterforms from the
artwork's own outlines. The artwork is kept at `scripts/dds-logo-mark.png` and
`node scripts/trace-logo.js` regenerates the path data, so if the logo ever
changes the mark can be reproduced rather than redrawn by hand.

One deliberate simplification: the artwork's gold is a gentle gradient
(#FDBA52 at the top and bottom vertices to #D88D0E at the sides), and the PDF
fills the band with the mean gold instead. jsPDF only does gradients in an
"advanced" API mode that flips the coordinate system, and at the 18-24mm the
mark actually prints at the difference isn't visible — a single flat path is
also easier to edit downstream than four gradient-filled wedges.

**Storage paths are configurable.** `DDS_DATA_DIR` and `DDS_PDF_DIR` override
where the JSON files and PDFs live, if you'd rather mount volumes somewhere
other than `/app/data` and `/app/pdfs`.

**The JSON files are the database.** They're written with a temp-file-plus-
rename so an unlucky crash or power cut can't leave a half-written file that
the app then can't read. Back up `data/` (Section 7).
