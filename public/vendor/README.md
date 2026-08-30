# Vendored browser libraries

`jspdf.umd.min.js` is used by `payslip.html` and `invoice.html` to generate
the PDF documents (the drawing itself lives in `public/pdf-docs.js`). It was
previously loaded from cdnjs at runtime; it's kept here instead so that:

- PDF generation still works when the office internet is down or slow,
- a CDN outage can't break payroll day,
- the exact bytes being run are pinned in the repo rather than fetched fresh
  on every page load.

| File               | Package | Version | Source                                      |
|--------------------|---------|---------|---------------------------------------------|
| `jspdf.umd.min.js` | jspdf   | 2.5.1   | npm `jspdf@2.5.1` → `dist/jspdf.umd.min.js` |

`html2canvas` used to live here too. It was only needed to screenshot the
HTML preview into a page image; now that the PDFs are drawn as vector
graphics, nothing uses it and it has been removed.

## Updating

Don't edit these files by hand. To move to a newer version:

```bash
npm pack jspdf@<version>
tar -xzf jspdf-<version>.tgz
cp package/dist/jspdf.umd.min.js public/vendor/
```

Then regenerate one payslip and one invoice and check the PDF still looks
right before committing — this library controls the rendered output, so a
version bump is a visual change, not just a dependency bump.
