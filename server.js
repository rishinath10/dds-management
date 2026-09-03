require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3300;

// Storage locations default to the app folder, but can be pointed elsewhere —
// handy for mounting persistent volumes at arbitrary paths, and for tests.
const DATA_DIR = process.env.DDS_DATA_DIR || path.join(__dirname, 'data');
const PDF_DIR = process.env.DDS_PDF_DIR || path.join(__dirname, 'pdfs');
const PDF_PAYSLIPS_DIR = path.join(PDF_DIR, 'payslips');
const PDF_INVOICES_DIR = path.join(PDF_DIR, 'invoices');

const EMP_FILE = path.join(DATA_DIR, 'employees.json');
const COMPANY_FILE = path.join(DATA_DIR, 'company.json');
const PAYSLIPS_FILE = path.join(DATA_DIR, 'payslips.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const INVOICE_SETTINGS_FILE = path.join(DATA_DIR, 'invoice_settings.json');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');

// ---- ensure storage exists ----
for (const dir of [DATA_DIR, PDF_DIR, PDF_PAYSLIPS_DIR, PDF_INVOICES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function ensureFile(file, defaultContent) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultContent, null, 2));
}
ensureFile(EMP_FILE, []);
ensureFile(COMPANY_FILE, {
  name: 'DDS Marine Energy Services Sdn Bhd',
  regNo: '',
  address: '',
  epfNo: '',
  socsoNo: ''
});
ensureFile(PAYSLIPS_FILE, []);
ensureFile(CLIENTS_FILE, []);
// Seeded from the actual Invoice_73.pdf template Rishi uploaded — real data, not placeholders.
ensureFile(INVOICE_SETTINGS_FILE, {
  companyName: 'DDS MARINE ENERGY SERVICES SDN BHD',
  headerAddressLine1: 'Level 5, Straits Quay Office Block, Jalan Seri Tg Pinang, 10470',
  headerAddressLine2: 'Tanjung Tokong, Penang',
  headerAddressLine3: 'Penang Penang 10470',
  headerCountry: 'MY',
  tradingEmail: 'trading@ddsgroup.info',
  regLine: '202401006820 : (1552670-D)',
  payCompanyName: 'DDS MARINE ENERGY SERVICES SDN.BHD',
  payRegNo: '(1552670-D)',
  payAddressLine1: '29, Denai Endau 9, Seri Tanjung Pinang',
  payAddressLine2: '10470 Tanjung Tokong,',
  payAddressLine3: 'Pulau Pinang,Malaysia',
  payContact: '+60165063003',
  payMail: 'captdinesh@ddsgroup.info',
  bankName: 'UOB BANK BERHAD',
  bankSwift: 'UOVBMYKL',
  bankMyrAcct: '265-312-169-7 ( Follow bank exchange rate of the day )',
  bankUsdAcct: '265-905-233-6',
  bankBranchAddress: '9, Jalan Kelawai, Kampung Syed, 10250 George Town, Pulau Pinang',
  bankOfficerNo: '+60164143457',
  bankOfficerName: 'Vyronice',
  bankOfficerMail: 'hueysy.kong@uob.com.my'
});
ensureFile(INVOICES_FILE, []);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}
// Write via temp file + rename so a crash mid-write can't leave a half-written
// (unparseable) data file behind — these tiny JSON files are the real database.
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Anything that ends up in a filename goes through this first. Without it a
// value like "../../etc/x" in an invoice number would escape the pdfs/ tree.
function safeSegment(value, fallback) {
  const cleaned = String(value == null ? '' : value).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

// Older archive records were written without an id. Backfill once on boot so
// every record can be addressed by /api/<kind>/:id/pdf.
function backfillIds(file, prefix) {
  const records = readJson(file);
  if (!Array.isArray(records)) return;
  let changed = false;
  for (const r of records) {
    if (!r.id) { r.id = prefix + crypto.randomUUID(); changed = true; }
  }
  if (changed) writeJson(file, records);
}
backfillIds(PAYSLIPS_FILE, 'ps_');
backfillIds(INVOICES_FILE, 'inv_');

// Resolve an archived record's PDF and stream it back. The filename always
// comes from our own stored record, never from the URL, and the resolved path
// is re-checked against the archive directory before anything is read.
function sendArchivedPdf(res, dir, record) {
  if (!record || !record.filename) return res.status(404).json({ error: 'Not found.' });
  const filePath = path.resolve(dir, record.filename);
  if (path.relative(dir, filePath).startsWith('..') || path.isAbsolute(path.relative(dir, filePath))) {
    return res.status(400).json({ error: 'Invalid path.' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF missing on disk — it may have been removed after archiving.' });
  }
  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${record.filename}"`);
  fs.createReadStream(filePath).pipe(res);
}

// Decode the base64 payload the browser sends and write it into the archive.
//
// jsPDF's output('datauristring') returns "data:application/pdf;filename=...;base64,<data>"
// — the filename parameter in the middle means a naive /^data:application\/pdf;base64,/
// strip leaves the prefix attached. Node's base64 decoder skips the punctuation
// but happily decodes the rest, producing a corrupt PDF with no error raised.
// So strip everything up to and including the ";base64," marker, and verify the
// %PDF magic bytes afterwards so a bad payload fails loudly instead of silently.
function writePdfFromBase64(dir, filename, pdfBase64) {
  const raw = String(pdfBase64);
  const marker = raw.indexOf(';base64,');
  const base64Data = marker > -1 ? raw.slice(marker + ';base64,'.length) : raw;
  const buf = Buffer.from(base64Data, 'base64');
  if (!buf.length || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error('Payload is not a valid PDF.');
  }
  fs.writeFileSync(path.join(dir, filename), buf);
}

// ---- HTTP Basic Auth ----
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

app.use((req, res, next) => {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    console.warn('WARNING: ADMIN_USER / ADMIN_PASS not set in .env — this app is currently UNPROTECTED.');
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="DDS Dashboard"');
    return res.status(401).send('Authentication required.');
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const sep = decoded.indexOf(':');
  const u = decoded.slice(0, sep);
  const p = decoded.slice(sep + 1);
  if (safeCompare(u, user) && safeCompare(p, pass)) return next();
  res.set('WWW-Authenticate', 'Basic realm="DDS Dashboard"');
  return res.status(401).send('Invalid credentials.');
});

// Generated PDFs arrive base64-encoded in the JSON body. A one-page document
// is a few hundred KB; the headroom covers long multi-page invoices.
app.use(express.json({ limit: '25mb' }));

// Without this, an over-limit body surfaces as a bare HTML error page and the
// UI can only say "Save failed" — say what actually went wrong instead.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'That PDF is too large to archive. Try fewer line items, or archive it in two documents.'
    });
  }
  if (err && err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request body.' });
  }
  return next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// Employees (Payslips module)
// =========================================================
app.get('/api/employees', (req, res) => {
  res.json(readJson(EMP_FILE) || []);
});

app.post('/api/employees', (req, res) => {
  const employees = readJson(EMP_FILE) || [];
  const incoming = req.body || {};
  if (!incoming.name || !incoming.name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!incoming.id) incoming.id = 'emp_' + crypto.randomUUID();
  const idx = employees.findIndex(e => e.id === incoming.id);
  if (idx > -1) employees[idx] = incoming; else employees.push(incoming);
  writeJson(EMP_FILE, employees);
  res.json(incoming);
});

app.delete('/api/employees/:id', (req, res) => {
  let employees = readJson(EMP_FILE) || [];
  employees = employees.filter(e => e.id !== req.params.id);
  writeJson(EMP_FILE, employees);
  res.json({ ok: true });
});

// ---- Company / payslip letterhead settings ----
app.get('/api/company', (req, res) => {
  res.json(readJson(COMPANY_FILE) || {});
});

app.post('/api/company', (req, res) => {
  writeJson(COMPANY_FILE, req.body || {});
  res.json(req.body || {});
});

// ---- Payslip PDF archive ----
app.post('/api/payslips', (req, res) => {
  const { employeeId, employeeName, payMonth, pdfBase64, figures } = req.body || {};
  if (!pdfBase64 || !employeeName || !payMonth) {
    return res.status(400).json({ error: 'employeeName, payMonth and pdfBase64 are required.' });
  }

  const payslips = readJson(PAYSLIPS_FILE) || [];
  const month = safeSegment(payMonth, 'unknown-month');

  // Re-archiving the same person's same month replaces that entry rather than
  // stacking a second record pointing at the same overwritten file.
  const existingIdx = payslips.findIndex(p => p.employeeId === employeeId && p.payMonth === payMonth);

  // Two different staff with the same name would otherwise overwrite each
  // other's PDF, so disambiguate with a short id suffix when that would happen.
  let filename = `${safeSegment(employeeName, 'staff')}_${month}.pdf`;
  const clash = payslips.some((p, i) => i !== existingIdx && p.filename === filename && p.employeeId !== employeeId);
  if (clash) filename = `${safeSegment(employeeName, 'staff')}_${safeSegment(employeeId, 'x').slice(-6)}_${month}.pdf`;

  try {
    writePdfFromBase64(PDF_PAYSLIPS_DIR, filename, pdfBase64);
  } catch (e) {
    console.error('Failed to write PDF', e);
    return res.status(500).json({ error: 'Failed to save PDF on server.' });
  }

  const record = {
    id: existingIdx > -1 ? payslips[existingIdx].id : 'ps_' + crypto.randomUUID(),
    employeeId,
    employeeName,
    payMonth,
    filename,
    figures: figures || null,
    savedAt: new Date().toISOString()
  };
  if (existingIdx > -1) payslips[existingIdx] = record; else payslips.push(record);
  writeJson(PAYSLIPS_FILE, payslips);

  res.json({ ok: true, filename, id: record.id, replaced: existingIdx > -1 });
});

app.get('/api/payslips', (req, res) => {
  const payslips = readJson(PAYSLIPS_FILE) || [];
  const { employeeId } = req.query;
  res.json(employeeId ? payslips.filter(p => p.employeeId === employeeId) : payslips);
});

app.get('/api/payslips/:id/pdf', (req, res) => {
  const payslips = readJson(PAYSLIPS_FILE) || [];
  sendArchivedPdf(res, PDF_PAYSLIPS_DIR, payslips.find(p => p.id === req.params.id));
});

// Deletes both the archive record and its PDF. The next rclone sync (it runs
// `rclone sync`, which mirrors deletions) removes it from Drive too — this is
// permanent, not a trash/recycle bin.
app.delete('/api/payslips/:id', (req, res) => {
  const payslips = readJson(PAYSLIPS_FILE) || [];
  const record = payslips.find(p => p.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Payslip not found.' });

  if (record.filename) {
    try { fs.unlinkSync(path.join(PDF_PAYSLIPS_DIR, record.filename)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  writeJson(PAYSLIPS_FILE, payslips.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// =========================================================
// Clients (Invoices module)
// =========================================================
app.get('/api/clients', (req, res) => {
  res.json(readJson(CLIENTS_FILE) || []);
});

app.post('/api/clients', (req, res) => {
  const clients = readJson(CLIENTS_FILE) || [];
  const incoming = req.body || {};
  if (!incoming.name || !incoming.name.trim()) {
    return res.status(400).json({ error: 'Client name is required.' });
  }
  if (!incoming.id) incoming.id = 'client_' + crypto.randomUUID();
  const idx = clients.findIndex(c => c.id === incoming.id);
  if (idx > -1) clients[idx] = incoming; else clients.push(incoming);
  writeJson(CLIENTS_FILE, clients);
  res.json(incoming);
});

app.delete('/api/clients/:id', (req, res) => {
  let clients = readJson(CLIENTS_FILE) || [];
  clients = clients.filter(c => c.id !== req.params.id);
  writeJson(CLIENTS_FILE, clients);
  res.json({ ok: true });
});

// ---- Invoice header / payment-instruction settings ----
app.get('/api/invoice-settings', (req, res) => {
  res.json(readJson(INVOICE_SETTINGS_FILE) || {});
});

app.post('/api/invoice-settings', (req, res) => {
  writeJson(INVOICE_SETTINGS_FILE, req.body || {});
  res.json(req.body || {});
});

// ---- Next invoice number (suggestion only, always editable in the UI) ----
app.get('/api/invoices/next-number', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  const nums = invoices
    .map(i => parseInt(String(i.invoiceNumber).replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  res.json({ next });
});

// ---- Invoice PDF archive ----
app.post('/api/invoices', (req, res) => {
  const { invoiceNumber, clientId, clientName, total, pdfBase64,
          date, dueDate, notes, subtotal, items } = req.body || {};
  if (!pdfBase64 || !invoiceNumber) {
    return res.status(400).json({ error: 'invoiceNumber and pdfBase64 are required.' });
  }

  const filename = `Invoice_${safeSegment(invoiceNumber, 'unnumbered')}.pdf`;

  try {
    writePdfFromBase64(PDF_INVOICES_DIR, filename, pdfBase64);
  } catch (e) {
    console.error('Failed to write invoice PDF', e);
    return res.status(500).json({ error: 'Failed to save PDF on server.' });
  }

  const invoices = readJson(INVOICES_FILE) || [];
  // Re-saving the same invoice number overwrites its PDF, so replace the
  // record too instead of leaving a stale duplicate behind.
  const existingIdx = invoices.findIndex(i => String(i.invoiceNumber) === String(invoiceNumber));

  // Line items are stored so a past invoice can be reopened and re-issued
  // without retyping it — the PDF alone isn't machine-readable.
  const record = {
    id: existingIdx > -1 ? invoices[existingIdx].id : 'inv_' + crypto.randomUUID(),
    invoiceNumber,
    clientId,
    clientName,
    total,
    subtotal: subtotal != null ? subtotal : total,
    date: date || '',
    dueDate: dueDate || '',
    notes: notes || '',
    items: Array.isArray(items) ? items : [],
    filename,
    savedAt: new Date().toISOString()
  };
  if (existingIdx > -1) invoices[existingIdx] = record; else invoices.push(record);
  writeJson(INVOICES_FILE, invoices);

  res.json({ ok: true, filename, id: record.id, replaced: existingIdx > -1 });
});

app.get('/api/invoices', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  const { clientId } = req.query;
  res.json(clientId ? invoices.filter(i => i.clientId === clientId) : invoices);
});

// Single archived invoice — used to reopen/duplicate a past invoice.
app.get('/api/invoices/:id', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  const found = invoices.find(i => i.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'Invoice not found.' });
  res.json(found);
});

app.get('/api/invoices/:id/pdf', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  sendArchivedPdf(res, PDF_INVOICES_DIR, invoices.find(i => i.id === req.params.id));
});

// Deletes both the archive record and its PDF. The next rclone sync (it runs
// `rclone sync`, which mirrors deletions) removes it from Drive too — this is
// permanent, not a trash/recycle bin.
app.delete('/api/invoices/:id', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  const record = invoices.find(i => i.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Invoice not found.' });

  if (record.filename) {
    try { fs.unlinkSync(path.join(PDF_INVOICES_DIR, record.filename)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  writeJson(INVOICES_FILE, invoices.filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

// =========================================================
// Dashboard stats
// =========================================================
app.get('/api/stats', (req, res) => {
  const payslips = readJson(PAYSLIPS_FILE) || [];
  const invoices = readJson(INVOICES_FILE) || [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const invoicedThisMonth = invoices
    .filter(i => String(i.date || i.savedAt || '').slice(0, 7) === thisMonth)
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);

  res.json({
    employees: (readJson(EMP_FILE) || []).length,
    clients: (readJson(CLIENTS_FILE) || []).length,
    payslips: payslips.length,
    invoices: invoices.length,
    payslipsThisMonth: payslips.filter(p => p.payMonth === thisMonth).length,
    invoicedThisMonth: Math.round(invoicedThisMonth * 100) / 100,
    invoicedTotal: Math.round(invoices.reduce((s, i) => s + (Number(i.total) || 0), 0) * 100) / 100,
    lastPayslipAt: payslips.length ? payslips[payslips.length - 1].savedAt : null,
    lastInvoiceAt: invoices.length ? invoices[invoices.length - 1].savedAt : null
  });
});

app.listen(PORT, () => {
  console.log(`DDS Dashboard running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    console.warn('Reminder: set ADMIN_USER and ADMIN_PASS in .env before exposing this publicly.');
  }
});
