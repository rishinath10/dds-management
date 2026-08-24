require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3300;

const DATA_DIR = path.join(__dirname, 'data');
const PDF_DIR = path.join(__dirname, 'pdfs');
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
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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

app.use(express.json({ limit: '15mb' }));
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
  const { employeeId, employeeName, payMonth, pdfBase64 } = req.body || {};
  if (!pdfBase64 || !employeeName || !payMonth) {
    return res.status(400).json({ error: 'employeeName, payMonth and pdfBase64 are required.' });
  }
  const safeName = employeeName.replace(/[^a-z0-9]+/gi, '_');
  const filename = `${safeName}_${payMonth}.pdf`;
  const filePath = path.join(PDF_PAYSLIPS_DIR, filename);
  const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');

  try {
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  } catch (e) {
    console.error('Failed to write PDF', e);
    return res.status(500).json({ error: 'Failed to save PDF on server.' });
  }

  const payslips = readJson(PAYSLIPS_FILE) || [];
  payslips.push({
    employeeId,
    employeeName,
    payMonth,
    filename,
    savedAt: new Date().toISOString()
  });
  writeJson(PAYSLIPS_FILE, payslips);

  res.json({ ok: true, filename });
});

app.get('/api/payslips', (req, res) => {
  const payslips = readJson(PAYSLIPS_FILE) || [];
  const { employeeId } = req.query;
  res.json(employeeId ? payslips.filter(p => p.employeeId === employeeId) : payslips);
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
  const { invoiceNumber, clientId, clientName, total, pdfBase64 } = req.body || {};
  if (!pdfBase64 || !invoiceNumber) {
    return res.status(400).json({ error: 'invoiceNumber and pdfBase64 are required.' });
  }
  const filename = `Invoice_${invoiceNumber}.pdf`;
  const filePath = path.join(PDF_INVOICES_DIR, filename);
  const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');

  try {
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  } catch (e) {
    console.error('Failed to write invoice PDF', e);
    return res.status(500).json({ error: 'Failed to save PDF on server.' });
  }

  const invoices = readJson(INVOICES_FILE) || [];
  invoices.push({
    invoiceNumber,
    clientId,
    clientName,
    total,
    filename,
    savedAt: new Date().toISOString()
  });
  writeJson(INVOICES_FILE, invoices);

  res.json({ ok: true, filename });
});

app.get('/api/invoices', (req, res) => {
  const invoices = readJson(INVOICES_FILE) || [];
  const { clientId } = req.query;
  res.json(clientId ? invoices.filter(i => i.clientId === clientId) : invoices);
});

app.listen(PORT, () => {
  console.log(`DDS Dashboard running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    console.warn('Reminder: set ADMIN_USER and ADMIN_PASS in .env before exposing this publicly.');
  }
});
