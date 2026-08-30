/**
 * Vector PDF builders for the DDS payslip and invoice.
 *
 * These draw the documents with jsPDF's native primitives — real text, real
 * lines, real filled shapes — rather than screenshotting the HTML preview into
 * a page image. That means the output opens in Adobe Illustrator or any PDF
 * editor with every element individually selectable and editable, the text is
 * searchable and copyable, and it stays sharp at any zoom. Files come out at
 * roughly 10-20 KB instead of ~250 KB.
 *
 * The on-screen preview in payslip.html / invoice.html is still HTML+CSS; this
 * file is the print representation of the same document. Keep the two in step
 * when changing a layout.
 *
 * Fonts are jsPDF's built-in Helvetica (one of the 14 standard PDF fonts, so
 * nothing is embedded and the files stay small). It matches the Helvetica Neue
 * / Arial stack the screen preview uses. A PDF editor may substitute a local
 * equivalent when editing — the text stays fully editable either way.
 *
 * All coordinates are millimetres on A4 (210 × 297).
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- constants

  var PAGE_W = 210;
  var PAGE_H = 297;
  var MARGIN = 16;
  var CONTENT_W = PAGE_W - MARGIN * 2;

  // Same palette as the screen preview.
  var NAVY = [14, 34, 64];
  var GOLD = [200, 151, 63];
  var CREAM = [247, 243, 234];
  var INK = [28, 28, 28];
  var MUTED = [107, 114, 128];
  var LINE = [227, 221, 205];
  var WHITE = [255, 255, 255];
  var ROW_TINT = [250, 247, 239];

  // ---------------------------------------------------------------- helpers

  function money(n) {
    var v = Number(n) || 0;
    var s = Math.abs(v).toFixed(2);
    var parts = s.split('.');
    // Thousands separators, without relying on locale support in the PDF.
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + 'RM ' + parts.join('.');
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  function monthLabel(ym) {
    if (!ym) return '';
    var p = String(ym).split('-');
    var m = Number(p[1]);
    if (!p[0] || !m) return String(ym);
    return MONTHS[m - 1] + ' ' + p[0];
  }

  function dateLabel(ymd) {
    if (!ymd) return '—';
    var p = String(ymd).split('-');
    var m = Number(p[1]);
    if (!p[0] || !m || !p[2]) return String(ymd);
    return String(p[2]).padStart(2, '0') + ' ' + MONTHS[m - 1] + ' ' + p[0];
  }

  function todayLabel() {
    var d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  // Small wrappers so the layout code below reads as intent, not jsPDF calls.
  function setFont(pdf, style, size, color) {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
  }

  function fillRect(pdf, x, y, w, h, color) {
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.rect(x, y, w, h, 'F');
  }

  function strokeRect(pdf, x, y, w, h, color, width) {
    pdf.setDrawColor(color[0], color[1], color[2]);
    pdf.setLineWidth(width == null ? 0.2 : width);
    pdf.rect(x, y, w, h, 'S');
  }

  function hLine(pdf, x1, y, x2, color, width) {
    pdf.setDrawColor(color[0], color[1], color[2]);
    pdf.setLineWidth(width == null ? 0.2 : width);
    pdf.line(x1, y, x2, y);
  }

  // Rounded rectangle with an optional border, used for the highlight bands.
  function band(pdf, x, y, w, h, fill, border, radius) {
    var r = radius == null ? 2 : radius;
    pdf.setFillColor(fill[0], fill[1], fill[2]);
    if (border) {
      pdf.setDrawColor(border[0], border[1], border[2]);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(x, y, w, h, r, r, 'FD');
    } else {
      pdf.roundedRect(x, y, w, h, r, r, 'F');
    }
  }

  /**
   * The DDS diamond mark, drawn as vector paths: a gold diamond ring with the
   * letters DDS inside. Drawn rather than placed as a PNG so the logo is
   * editable and stays crisp — this is the whole point of the vector export.
   */
  function drawLogoMark(pdf, cx, cy, size) {
    var r = size / 2;
    var inner = r * 0.76; // ring thickness

    function diamond(radius) {
      return [
        [radius, radius], [-radius, radius], [-radius, -radius]
      ];
    }

    // Outer diamond filled gold, inner diamond knocked back out in white —
    // together they read as a diamond outline of even thickness.
    pdf.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
    pdf.lines(diamond(r), cx, cy - r, [1, 1], 'F', true);
    pdf.setFillColor(WHITE[0], WHITE[1], WHITE[2]);
    pdf.lines(diamond(inner), cx, cy - inner, [1, 1], 'F', true);

    // "DDS" centred inside, letter-spaced to match the brand mark.
    var letterSize = size * 0.36;
    setFont(pdf, 'bold', letterSize, NAVY);
    var gap = size * 0.075;
    var letters = ['D', 'D', 'S'];
    var widths = letters.map(function (ch) { return pdf.getTextWidth(ch); });
    var totalW = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (letters.length - 1);
    var x = cx - totalW / 2;
    letters.forEach(function (ch, i) {
      pdf.text(ch, x, cy + letterSize * 0.35 / 2.83465);
      x += widths[i] + gap;
    });
  }

  // Draw text and return the y position just past it, wrapping to `width`.
  function paragraph(pdf, text, x, y, width, lineHeight) {
    var lines = pdf.splitTextToSize(String(text == null ? '' : text), width);
    for (var i = 0; i < lines.length; i++) {
      pdf.text(lines[i], x, y + i * lineHeight);
    }
    return y + lines.length * lineHeight;
  }

  // ---------------------------------------------------------------- payslip

  function buildPayslip(data) {
    var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    var pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format: 'a4' });

    var company = data.company || {};
    var emp = data.employee || {};
    var p = data.payslip || {};

    var y = MARGIN;

    // ---- header -------------------------------------------------------
    drawLogoMark(pdf, MARGIN + 9, y + 9, 18);

    var textX = MARGIN + 23;
    setFont(pdf, 'bold', 12, NAVY);
    pdf.text(String(company.name || ''), textX, y + 6);

    setFont(pdf, 'normal', 7.5, MUTED);
    var addrY = y + 10.5;
    if (company.address) {
      addrY = paragraph(pdf, company.address, textX, addrY, 78, 3.4);
    }
    if (company.regNo) {
      pdf.text('Reg. No: ' + company.regNo, textX, addrY);
    }

    setFont(pdf, 'bold', 16, NAVY);
    pdf.text('PAYSLIP', PAGE_W - MARGIN, y + 6, { align: 'right' });
    setFont(pdf, 'bold', 8.5, GOLD);
    pdf.text(monthLabel(p.payMonth), PAGE_W - MARGIN, y + 11, { align: 'right' });
    setFont(pdf, 'normal', 7.5, MUTED);
    var ref = 'DDS/PS/' + String(p.payMonth || '').replace('-', '') + '/' +
              (emp.staffId || String(emp.id || '').slice(-4));
    pdf.text('Ref: ' + ref, PAGE_W - MARGIN, y + 15.5, { align: 'right' });

    y += 21;
    hLine(pdf, MARGIN, y, PAGE_W - MARGIN, GOLD, 1);
    y += 7;

    // ---- employee details --------------------------------------------
    var colW = CONTENT_W / 2;
    var rows = [
      ['Employee Name', emp.name || '—', 'Staff ID', emp.staffId || '—'],
      ['Position', emp.position || '—', 'NRIC No.', emp.ic || '—'],
      ['Pay Period', monthLabel(p.payMonth), 'Payment Date', dateLabel(p.payDate)],
      ['Bank', emp.bank || '—', 'Account No.', emp.bankAcc || '—'],
      ['EPF No.', emp.epfNo || '—', 'SOCSO/EIS No.', emp.socsoNo || '—']
    ];
    rows.forEach(function (r) {
      setFont(pdf, 'normal', 8, MUTED);
      pdf.text(r[0], MARGIN, y);
      pdf.text(r[2], MARGIN + colW, y);
      setFont(pdf, 'bold', 8, INK);
      pdf.text(String(r[1]), MARGIN + 26, y);
      pdf.text(String(r[3]), MARGIN + colW + 26, y);
      y += 5;
    });

    y += 4;

    // ---- earnings / deductions ---------------------------------------
    var gap = 6;
    var boxW = (CONTENT_W - gap) / 2;
    var leftX = MARGIN;
    var rightX = MARGIN + boxW + gap;

    var earnings = [['Basic Salary', p.basic]];
    (p.allowanceLines || []).forEach(function (l) {
      earnings.push([l.label || 'Allowance', l.amount]);
    });
    earnings.push(['Overtime', p.otAmt]);
    earnings.push(['Commission', p.comm]);

    var deductions = [
      ['EPF (Employee)', p.epf ? p.epf.employee : 0],
      ['SOCSO (Employee)', p.socso ? p.socso.employee : 0],
      ['EIS (Employee)', p.eis ? p.eis.employee : 0]
    ];
    (p.deductionLines || []).forEach(function (l) {
      deductions.push([l.label || 'Other deduction', l.amount]);
    });

    function drawBlock(x, title, items, totalLabel, totalValue) {
      var yy = y;
      var headH = 7;
      var rowH = 6;

      fillRect(pdf, x, yy, boxW, headH, NAVY);
      setFont(pdf, 'bold', 7.5, WHITE);
      pdf.text(title.toUpperCase(), x + 3, yy + 4.7);
      yy += headH;

      items.forEach(function (it) {
        setFont(pdf, 'normal', 8, INK);
        var label = pdf.splitTextToSize(String(it[0]), boxW - 26)[0];
        pdf.text(label, x + 3, yy + 4.1);
        pdf.text(money(it[1]), x + boxW - 3, yy + 4.1, { align: 'right' });
        hLine(pdf, x, yy + rowH, x + boxW, LINE, 0.15);
        yy += rowH;
      });

      fillRect(pdf, x, yy, boxW, rowH, ROW_TINT);
      setFont(pdf, 'bold', 8, NAVY);
      pdf.text(totalLabel, x + 3, yy + 4.1);
      pdf.text(money(totalValue), x + boxW - 3, yy + 4.1, { align: 'right' });
      yy += rowH;

      strokeRect(pdf, x, y + headH, boxW, yy - y - headH, LINE, 0.15);
      return yy;
    }

    var leftEnd = drawBlock(leftX, 'Earnings', earnings, 'Gross Earnings', p.gross);
    var rightEnd = drawBlock(rightX, 'Deductions', deductions, 'Total Deductions', p.totalDeductions);
    y = Math.max(leftEnd, rightEnd) + 7;

    // ---- net pay ------------------------------------------------------
    var netH = 14;
    band(pdf, MARGIN, y, CONTENT_W, netH, CREAM, GOLD, 2);
    setFont(pdf, 'bold', 9.5, NAVY);
    pdf.text('NET PAY', MARGIN + 5, y + netH / 2 + 1.2);
    setFont(pdf, 'bold', 16, NAVY);
    pdf.text(money(p.net), PAGE_W - MARGIN - 5, y + netH / 2 + 2, { align: 'right' });
    y += netH + 8;

    // ---- remarks ------------------------------------------------------
    if (p.remarks) {
      setFont(pdf, 'bold', 7.5, NAVY);
      pdf.text('Remarks:', MARGIN, y);
      setFont(pdf, 'normal', 7.5, MUTED);
      y = paragraph(pdf, p.remarks, MARGIN + 16, y, CONTENT_W - 16, 3.6) + 4;
    }

    // ---- employer contributions --------------------------------------
    hLine(pdf, MARGIN, y, PAGE_W - MARGIN, LINE, 0.15);
    y += 4.5;
    setFont(pdf, 'normal', 7.5, MUTED);
    pdf.text('Employer contributions (for records — not deducted from employee):', MARGIN, y);
    y += 4.5;

    [['EPF (Employer)', p.epf ? p.epf.employer : 0],
     ['SOCSO (Employer)', p.socso ? p.socso.employer : 0],
     ['EIS (Employer)', p.eis ? p.eis.employer : 0]].forEach(function (r) {
      setFont(pdf, 'normal', 7.5, MUTED);
      pdf.text(r[0], MARGIN, y);
      pdf.text(money(r[1]), PAGE_W - MARGIN, y, { align: 'right' });
      y += 4;
    });

    // ---- footer -------------------------------------------------------
    var footY = PAGE_H - MARGIN - 6;
    hLine(pdf, MARGIN, footY - 4, PAGE_W - MARGIN, LINE, 0.15);
    setFont(pdf, 'normal', 6.5, MUTED);
    pdf.text('This is a computer-generated payslip and does not require a signature. Generated on ' +
             todayLabel() + '.', PAGE_W / 2, footY, { align: 'center' });
    pdf.text(String(company.name || '') + (company.address ? ' · ' + String(company.address).replace(/\n/g, ' ') : ''),
             PAGE_W / 2, footY + 3.5, { align: 'center' });

    return pdf;
  }

  // ---------------------------------------------------------------- invoice

  function buildInvoice(data) {
    var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    var pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format: 'a4' });

    var s = data.settings || {};
    var client = data.client || {};
    var inv = data.invoice || {};

    var y = MARGIN;

    // ---- header -------------------------------------------------------
    drawLogoMark(pdf, MARGIN + 13, y + 12, 24);
    setFont(pdf, 'bolditalic', 6, INK);
    pdf.text('"Fueling Global Trade, Connecting Continents"', MARGIN + 13, y + 28, { align: 'center' });

    setFont(pdf, 'normal', 15, [68, 68, 68]);
    pdf.text('Invoice', PAGE_W - MARGIN, y + 5, { align: 'right' });

    setFont(pdf, 'bold', 9.5, NAVY);
    pdf.text(String(s.companyName || ''), PAGE_W - MARGIN, y + 11.5, { align: 'right' });

    setFont(pdf, 'normal', 7.5, MUTED);
    var hy = y + 16;
    [s.headerAddressLine1, s.headerAddressLine2, s.headerAddressLine3, s.headerCountry]
      .filter(Boolean)
      .forEach(function (line) {
        pdf.text(String(line), PAGE_W - MARGIN, hy, { align: 'right' });
        hy += 3.8;
      });
    hy += 2;
    if (s.tradingEmail) { pdf.text(String(s.tradingEmail), PAGE_W - MARGIN, hy, { align: 'right' }); hy += 3.8; }
    if (s.regLine) { pdf.text(String(s.regLine), PAGE_W - MARGIN, hy, { align: 'right' }); hy += 3.8; }

    y = Math.max(hy, y + 34) + 5;

    // ---- bill to band --------------------------------------------------
    // Height is measured from the content — a client with a long address and
    // two email addresses would otherwise spill outside the band.
    setFont(pdf, 'normal', 7.5, INK);
    var addrLines = String(client.address || '').replace(/\r/g, '')
      ? pdf.splitTextToSize(String(client.address).replace(/\r/g, ''), 85)
      : [];
    var emails = [client.email1, client.email2].filter(Boolean);
    var leftH = 16 + (addrLines.length + emails.length) * 3.6 + 2;
    var rightH = 7 + 3 * 5;
    var billH = Math.max(leftH, rightH, 24);

    band(pdf, MARGIN, y, CONTENT_W, billH, CREAM, null, 2);

    setFont(pdf, 'bold', 6.5, GOLD);
    pdf.text('BILL TO', MARGIN + 5, y + 6);
    setFont(pdf, 'bold', 10, NAVY);
    pdf.text(String(client.name || ''), MARGIN + 5, y + 11.5);

    var by = y + 16;
    setFont(pdf, 'normal', 7.5, INK);
    addrLines.forEach(function (line) { pdf.text(line, MARGIN + 5, by); by += 3.6; });
    setFont(pdf, 'normal', 7.5, MUTED);
    emails.forEach(function (e) { pdf.text(String(e), MARGIN + 5, by); by += 3.6; });

    var metaRight = PAGE_W - MARGIN - 5;
    var metaLabelX = metaRight - 32;
    [['Invoice #', String(inv.invoiceNumber || '')],
     ['Date', dateLabel(inv.date)],
     ['Due date', dateLabel(inv.dueDate)]].forEach(function (r, i) {
      var ry = y + 7 + i * 5;
      setFont(pdf, 'normal', 8, MUTED);
      pdf.text(r[0], metaLabelX, ry, { align: 'right' });
      setFont(pdf, 'bold', 8, NAVY);
      pdf.text(r[1], metaRight, ry, { align: 'right' });
    });

    y += billH + 7;

    // ---- line items ----------------------------------------------------
    // Columns: description gets the slack, the four numeric columns are fixed.
    var colQty = 22, colPrice = 26, colDisc = 24, colAmt = 28;
    var colDesc = CONTENT_W - (colQty + colPrice + colDisc + colAmt);
    var xDesc = MARGIN;
    var xQty = xDesc + colDesc;
    var xPrice = xQty + colQty;
    var xDisc = xPrice + colPrice;
    var xAmt = xDisc + colDisc;
    var headH = 8;

    function drawItemsHeader(atY) {
      fillRect(pdf, MARGIN, atY, CONTENT_W, headH, NAVY);
      setFont(pdf, 'bold', 7, WHITE);
      pdf.text('ITEM', xDesc + 3, atY + 5.3);
      pdf.text('QUANTITY', xQty + colQty - 3, atY + 5.3, { align: 'right' });
      pdf.text('PRICE', xPrice + colPrice - 3, atY + 5.3, { align: 'right' });
      pdf.text('DISCOUNT', xDisc + colDisc - 3, atY + 5.3, { align: 'right' });
      pdf.text('AMOUNT', xAmt + colAmt - 3, atY + 5.3, { align: 'right' });
      return atY + headH;
    }

    y = drawItemsHeader(y);

    var items = inv.items || [];
    // Reserve room for the totals block so it never lands on its own page
    // orphaned from the table.
    var bottomLimit = PAGE_H - MARGIN - 12;

    items.forEach(function (it) {
      setFont(pdf, 'normal', 8, INK);
      var lines = pdf.splitTextToSize(String(it.description || ''), colDesc - 6);
      if (!lines.length) lines = [''];
      var rowH = Math.max(lines.length * 4 + 4, 10);

      if (y + rowH > bottomLimit) {
        pdf.addPage();
        y = MARGIN;
        y = drawItemsHeader(y);
      }

      setFont(pdf, 'normal', 8, INK);
      for (var i = 0; i < lines.length; i++) {
        pdf.text(lines[i], xDesc + 3, y + 5 + i * 4);
      }
      pdf.text(String(it.qty == null ? '' : it.qty), xQty + colQty - 3, y + 5, { align: 'right' });
      pdf.text(money(it.price), xPrice + colPrice - 3, y + 5, { align: 'right' });
      pdf.text(it.discount ? money(it.discount) : '', xDisc + colDisc - 3, y + 5, { align: 'right' });
      pdf.text(money(it.amount), xAmt + colAmt - 3, y + 5, { align: 'right' });

      hLine(pdf, MARGIN, y + rowH, PAGE_W - MARGIN, LINE, 0.15);
      y += rowH;
    });

    y += 6;

    // ---- totals --------------------------------------------------------
    if (y + 40 > PAGE_H - MARGIN) { pdf.addPage(); y = MARGIN; }

    var totalsX = PAGE_W - MARGIN - 62;
    setFont(pdf, 'normal', 8, MUTED);
    pdf.text('Subtotal', totalsX, y);
    setFont(pdf, 'bold', 8, INK);
    pdf.text(money(inv.subtotal == null ? inv.total : inv.subtotal), PAGE_W - MARGIN, y, { align: 'right' });
    y += 3;
    hLine(pdf, totalsX, y, PAGE_W - MARGIN, LINE, 0.15);
    y += 4.5;
    setFont(pdf, 'bold', 9, NAVY);
    pdf.text('Total', totalsX, y);
    pdf.text(money(inv.total), PAGE_W - MARGIN, y, { align: 'right' });
    y += 8;

    // ---- amount due ----------------------------------------------------
    var dueH = 18;
    band(pdf, MARGIN, y, CONTENT_W, dueH, CREAM, GOLD, 2);
    setFont(pdf, 'bold', 7.5, NAVY);
    pdf.text('AMOUNT DUE', MARGIN + 5, y + 6.5);
    setFont(pdf, 'bold', 18, NAVY);
    pdf.text(money(inv.total), MARGIN + 5, y + 14.5);
    y += dueH + 7;

    // ---- notes ---------------------------------------------------------
    if (inv.notes) {
      setFont(pdf, 'bold', 8, INK);
      pdf.text('Notes:', MARGIN, y);
      setFont(pdf, 'normal', 8, INK);
      y = paragraph(pdf, inv.notes, MARGIN + 12, y, CONTENT_W - 12, 4) + 5;
    }

    // ---- payment instruction -------------------------------------------
    var payLines = [
      s.payCompanyName,
      s.payRegNo ? 'Reg No: ' + s.payRegNo : null,
      s.payAddressLine1, s.payAddressLine2, s.payAddressLine3,
      s.payContact ? 'Contact : ' + s.payContact : null,
      s.payMail ? 'Mail : ' + s.payMail : null,
      s.bankName,
      s.bankSwift ? 'Bank SWIFT : ' + s.bankSwift : null,
      s.bankMyrAcct ? 'MYR acct no: ' + s.bankMyrAcct : null,
      s.bankUsdAcct ? 'USD acct no: ' + s.bankUsdAcct : null,
      s.bankBranchAddress ? 'Bank branch address:' : null,
      s.bankBranchAddress,
      s.bankOfficerNo ? 'Bank officer no : ' + s.bankOfficerNo : null,
      s.bankOfficerName ? 'Bank officer name: ' + s.bankOfficerName : null,
      s.bankOfficerMail ? 'Bank officer mail: ' + s.bankOfficerMail : null
    ].filter(Boolean);

    var needed = 6 + payLines.length * 3.5;
    if (y + needed > PAGE_H - MARGIN) { pdf.addPage(); y = MARGIN; }

    hLine(pdf, MARGIN, y, PAGE_W - MARGIN, LINE, 0.15);
    y += 5;
    setFont(pdf, 'bold', 7.5, INK);
    pdf.text('Payment instruction', MARGIN, y);
    y += 4;
    setFont(pdf, 'normal', 7, MUTED);
    payLines.forEach(function (line) {
      pdf.text(String(line), MARGIN, y);
      y += 3.5;
    });

    return pdf;
  }

  global.DDSPdf = {
    buildPayslip: buildPayslip,
    buildInvoice: buildInvoice,
    // Exposed for tests / reuse.
    money: money,
    monthLabel: monthLabel,
    dateLabel: dateLabel
  };
})(typeof window !== 'undefined' ? window : this);
