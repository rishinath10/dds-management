# Vendored browser libraries

These two files are used by `payslip.html` and `invoice.html` to turn the
on-screen document into a PDF. They were previously loaded from cdnjs at
runtime; they're kept here instead so that:

- PDF generation still works when the office internet is down or slow,
- a CDN outage can't break payroll day,
- the exact bytes being run are pinned in the repo rather than fetched fresh
  on every page load.

| File                  | Package      | Version | Source                                      |
|-----------------------|--------------|---------|---------------------------------------------|
| `html2canvas.min.js`  | html2canvas  | 1.4.1   | npm `html2canvas@1.4.1` → `dist/html2canvas.min.js` |
| `jspdf.umd.min.js`    | jspdf        | 2.5.1   | npm `jspdf@2.5.1` → `dist/jspdf.umd.min.js`         |

Both are the same versions the app used from the CDN before, so PDF output is
unchanged.

## Updating

Don't edit these files by hand. To move to a newer version:

```bash
npm pack html2canvas@<version>     # or jspdf@<version>
tar -xzf html2canvas-<version>.tgz
cp package/dist/html2canvas.min.js public/vendor/
```

Then regenerate one payslip and one invoice and check the PDF still looks
right before committing — these libraries control the rendered output, so a
version bump is a visual change, not just a dependency bump.
