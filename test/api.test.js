// API smoke tests. Boots a real server against a throwaway data directory so
// nothing here touches the live data/ or pdfs/ folders.
//
// Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USER = 'testadmin';
const PASS = 'testpass';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

let child;
let baseUrl;
let tmpDir;

// A minimal but genuinely valid PDF, wrapped the way jsPDF's
// output('datauristring') wraps it (note the filename parameter).
const PDF_BYTES = Buffer.from(
  '%PDF-1.3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);
const PDF_DATA_URI =
  'data:application/pdf;filename=generated.pdf;base64,' + PDF_BYTES.toString('base64');

function api(pathname, options = {}) {
  return fetch(baseUrl + pathname, {
    ...options,
    headers: {
      Authorization: AUTH,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
}

const postJson = (pathname, body) =>
  api(pathname, { method: 'POST', body: JSON.stringify(body) });

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dds-test-'));
  const port = 3400 + Math.floor(Math.random() * 500);
  baseUrl = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_USER: USER,
      ADMIN_PASS: PASS,
      DDS_DATA_DIR: path.join(tmpDir, 'data'),
      DDS_PDF_DIR: path.join(tmpDir, 'pdfs')
    },
    stdio: 'ignore'
  });

  // Wait for the port to accept connections.
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      await fetch(baseUrl + '/api/stats', { headers: { Authorization: AUTH } });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('server did not start in time');
      await new Promise(r => setTimeout(r, 100));
    }
  }
});

after(() => {
  if (child) child.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- auth

test('rejects requests with no credentials', async () => {
  const res = await fetch(baseUrl + '/api/employees');
  assert.strictEqual(res.status, 401);
});

test('rejects requests with wrong credentials', async () => {
  const res = await fetch(baseUrl + '/api/employees', {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') }
  });
  assert.strictEqual(res.status, 401);
});

// ---------------------------------------------------------------- employees

test('creates, updates and deletes an employee', async () => {
  const created = await (await postJson('/api/employees', { name: 'Ali Bin Hassan', basic: 4000 })).json();
  assert.ok(created.id.startsWith('emp_'));

  const updated = await (await postJson('/api/employees', { ...created, basic: 4500 })).json();
  assert.strictEqual(updated.basic, 4500);

  const all = await (await api('/api/employees')).json();
  assert.strictEqual(all.filter(e => e.id === created.id).length, 1, 'update must not duplicate the record');

  await api('/api/employees/' + created.id, { method: 'DELETE' });
  const after = await (await api('/api/employees')).json();
  assert.strictEqual(after.find(e => e.id === created.id), undefined);
});

test('rejects an employee with no name', async () => {
  const res = await postJson('/api/employees', { basic: 100 });
  assert.strictEqual(res.status, 400);
});

// ---------------------------------------------------------------- payslip archive

test('archives a payslip and serves the PDF back intact', async () => {
  const emp = await (await postJson('/api/employees', { name: 'Siti Rahman', basic: 3000 })).json();

  const saved = await (await postJson('/api/payslips', {
    employeeId: emp.id,
    employeeName: 'Siti Rahman',
    payMonth: '2026-08',
    pdfBase64: PDF_DATA_URI,
    figures: { gross: 3000, net: 2670 }
  })).json();

  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.filename, 'Siti_Rahman_2026_08.pdf');

  // The bytes that come back must be a real PDF — this is the regression guard
  // for the jsPDF data-URI prefix that used to be decoded into the file.
  const pdfRes = await api(`/api/payslips/${saved.id}/pdf`);
  assert.strictEqual(pdfRes.status, 200);
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  assert.strictEqual(bytes.subarray(0, 4).toString('latin1'), '%PDF');
  assert.deepStrictEqual(bytes, PDF_BYTES);
});

test('re-archiving the same month replaces the entry instead of duplicating it', async () => {
  const emp = await (await postJson('/api/employees', { name: 'Chan Wei Ming', basic: 5000 })).json();
  const body = {
    employeeId: emp.id,
    employeeName: 'Chan Wei Ming',
    payMonth: '2026-07',
    pdfBase64: PDF_DATA_URI
  };

  const first = await (await postJson('/api/payslips', body)).json();
  const second = await (await postJson('/api/payslips', body)).json();

  assert.strictEqual(second.replaced, true);
  assert.strictEqual(second.id, first.id, 'the record id should be stable across re-saves');

  const mine = await (await api('/api/payslips?employeeId=' + emp.id)).json();
  assert.strictEqual(mine.length, 1);
});

test('two staff with the same name do not overwrite each other', async () => {
  const a = await (await postJson('/api/employees', { name: 'Raj Kumar' })).json();
  const b = await (await postJson('/api/employees', { name: 'Raj Kumar' })).json();

  const savedA = await (await postJson('/api/payslips', {
    employeeId: a.id, employeeName: 'Raj Kumar', payMonth: '2026-06', pdfBase64: PDF_DATA_URI
  })).json();
  const savedB = await (await postJson('/api/payslips', {
    employeeId: b.id, employeeName: 'Raj Kumar', payMonth: '2026-06', pdfBase64: PDF_DATA_URI
  })).json();

  assert.notStrictEqual(savedA.filename, savedB.filename);
});

test('rejects a payslip payload that is not a PDF', async () => {
  const res = await postJson('/api/payslips', {
    employeeId: 'emp_x',
    employeeName: 'Nobody',
    payMonth: '2026-08',
    pdfBase64: 'data:application/pdf;base64,' + Buffer.from('not a pdf').toString('base64')
  });
  assert.strictEqual(res.status, 500);
});

// ---------------------------------------------------------------- invoices

test('suggests the next invoice number from the highest seen', async () => {
  const client = await (await postJson('/api/clients', { name: 'Eastern Shipping Sdn Bhd' })).json();

  await postJson('/api/invoices', {
    invoiceNumber: '73', clientId: client.id, clientName: client.name,
    total: 1500, pdfBase64: PDF_DATA_URI
  });

  const { next } = await (await api('/api/invoices/next-number')).json();
  assert.strictEqual(next, 74, 'next-number must not be shadowed by the /:id route');
});

test('archives an invoice with line items and reads it back for duplication', async () => {
  const client = await (await postJson('/api/clients', { name: 'Straits Marine' })).json();
  const items = [
    { description: 'Vessel name : MT EASTERN QUINCE\nPOAC', qty: 2, price: 750, discount: 0, amount: 1500 }
  ];

  const saved = await (await postJson('/api/invoices', {
    invoiceNumber: '80',
    clientId: client.id,
    clientName: client.name,
    date: '2026-08-01',
    dueDate: '2026-08-30',
    notes: 'Payment within 30 days',
    subtotal: 1500,
    total: 1500,
    items,
    pdfBase64: PDF_DATA_URI
  })).json();

  const fetched = await (await api('/api/invoices/' + saved.id)).json();
  assert.deepStrictEqual(fetched.items, items, 'line items must survive the round trip');
  assert.strictEqual(fetched.notes, 'Payment within 30 days');
  assert.strictEqual(fetched.dueDate, '2026-08-30');

  const pdfRes = await api(`/api/invoices/${saved.id}/pdf`);
  assert.strictEqual(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 4).toString('latin1'), '%PDF');
});

test('an invoice number cannot escape the archive directory', async () => {
  const saved = await (await postJson('/api/invoices', {
    invoiceNumber: '../../../../tmp/escaped',
    clientName: 'Attacker',
    total: 0,
    pdfBase64: PDF_DATA_URI
  })).json();

  assert.ok(!saved.filename.includes('..'), `filename should be sanitised, got ${saved.filename}`);
  assert.ok(!saved.filename.includes('/'));
  assert.ok(fs.existsSync(path.join(tmpDir, 'pdfs', 'invoices', saved.filename)));
});

test('unknown archive ids 404 rather than leaking anything', async () => {
  assert.strictEqual((await api('/api/invoices/inv_nope/pdf')).status, 404);
  assert.strictEqual((await api('/api/payslips/ps_nope/pdf')).status, 404);
  assert.strictEqual((await api('/api/invoices/inv_nope')).status, 404);
});

// ---------------------------------------------------------------- deleting archived records

test('deletes an archived payslip: record disappears and the PDF is removed from disk', async () => {
  const emp = await (await postJson('/api/employees', { name: 'Farah Idris' })).json();
  const saved = await (await postJson('/api/payslips', {
    employeeId: emp.id, employeeName: 'Farah Idris', payMonth: '2026-05', pdfBase64: PDF_DATA_URI
  })).json();
  const filePath = path.join(tmpDir, 'pdfs', 'payslips', saved.filename);
  assert.ok(fs.existsSync(filePath), 'PDF should exist before delete');

  const del = await api('/api/payslips/' + saved.id, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await del.json()).ok, true);

  assert.strictEqual((await api('/api/payslips/' + saved.id + '/pdf')).status, 404);
  assert.ok(!fs.existsSync(filePath), 'PDF should be removed from disk, not just the record');
  const remaining = await (await api('/api/payslips?employeeId=' + emp.id)).json();
  assert.strictEqual(remaining.find(p => p.id === saved.id), undefined);
});

test('deletes an archived invoice: record disappears and the PDF is removed from disk', async () => {
  const client = await (await postJson('/api/clients', { name: 'Delete Me Shipping' })).json();
  const saved = await (await postJson('/api/invoices', {
    invoiceNumber: '901', clientId: client.id, clientName: client.name, total: 500, pdfBase64: PDF_DATA_URI
  })).json();
  const filePath = path.join(tmpDir, 'pdfs', 'invoices', saved.filename);
  assert.ok(fs.existsSync(filePath), 'PDF should exist before delete');

  const del = await api('/api/invoices/' + saved.id, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);

  assert.strictEqual((await api('/api/invoices/' + saved.id)).status, 404);
  assert.strictEqual((await api('/api/invoices/' + saved.id + '/pdf')).status, 404);
  assert.ok(!fs.existsSync(filePath), 'PDF should be removed from disk, not just the record');
});

test('deleting an unknown archive id 404s instead of silently no-opping', async () => {
  assert.strictEqual((await api('/api/payslips/ps_nope', { method: 'DELETE' })).status, 404);
  assert.strictEqual((await api('/api/invoices/inv_nope', { method: 'DELETE' })).status, 404);
});

test('deleting a record whose PDF is already missing from disk still succeeds', async () => {
  const client = await (await postJson('/api/clients', { name: 'Orphan Ltd' })).json();
  const saved = await (await postJson('/api/invoices', {
    invoiceNumber: '902', clientId: client.id, clientName: client.name, total: 10, pdfBase64: PDF_DATA_URI
  })).json();
  fs.unlinkSync(path.join(tmpDir, 'pdfs', 'invoices', saved.filename));

  const del = await api('/api/invoices/' + saved.id, { method: 'DELETE' });
  assert.strictEqual(del.status, 200, 'a missing file on disk should not block deleting the record');
});

// ---------------------------------------------------------------- body limits

// Archiving used to fail silently because generated PDFs exceeded the body
// limit and the UI could only report a generic "Save failed". These check the
// server explains itself instead.
test('an over-limit body returns a readable 413, not an HTML error page', async () => {
  const res = await postJson('/api/invoices', {
    invoiceNumber: '999',
    pdfBase64: 'x'.repeat(26 * 1024 * 1024)
  });
  assert.strictEqual(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /too large/i);
});

test('a malformed body returns a readable 400', async () => {
  const res = await api('/api/invoices', {
    method: 'POST',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /malformed/i);
});

// ---------------------------------------------------------------- stats

test('reports dashboard stats', async () => {
  const stats = await (await api('/api/stats')).json();
  assert.ok(stats.employees > 0);
  assert.ok(stats.clients > 0);
  assert.ok(stats.invoices > 0);
  assert.strictEqual(typeof stats.invoicedTotal, 'number');
});
