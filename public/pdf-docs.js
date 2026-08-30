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

  // ---------------------------------------------------------------- logo
  //
  // The DDS mark, as vector paths traced from the supplied logo artwork rather
  // than approximated — the diamond band from its measured proportions, the
  // DDS letterforms from the artwork's own outlines. Drawing it (instead of
  // placing the PNG) is what keeps the whole exported page vector: the mark
  // stays crisp at any zoom and can be recoloured or reshaped in Illustrator.
  //
  // Coordinates are normalised against the artwork: the origin is the centre
  // of the diamond and 1 unit is its half-width, so the whole mark scales from
  // a single `size` argument.
  //
  // Measured from the artwork (1593x1639 px, centre 796,819, half-width 796):
  var LOGO_INNER = 0.8656;  // inner diamond / outer, i.e. the band thickness
  var LOGO_ASPECT = 1.0264; // half-height / half-width — slightly tall, as drawn
  // The artwork's gold is a gentle gradient (#FDBA52 at the top and bottom
  // vertices to #D88D0E at the left and right). jsPDF 2.5.1 can only do
  // gradients in its "advanced" API mode, which flips the coordinate system
  // and would have to be entered and left around every logo; at 18-24mm the
  // difference is not visible, so the band is filled with the artwork's mean
  // gold and stays a single clean path that is easy to edit downstream.
  var LOGO_GOLD = [232, 161, 48];
  var LOGO_NAVY = [16, 56, 118];

  // Letter outlines, traced from the artwork with potrace and normalised.
  // Flat command stream: 0 = moveTo(x,y), 1 = curveTo(6), 2 = lineTo(2),
  // 3 = closePath. Regenerate with `node scripts/trace-logo.js` if the mark changes.
  var LOGO_LETTERS = [
    0, 0.3976, -0.2411, 1, 0.3483, -0.2346, 0.3216, -0.1997, 0.3216, -0.142,
    1, 0.3216, -0.0938, 0.3389, -0.062, 0.3911, -0.0142, 1, 0.4206, 0.0128,
    0.4357, 0.0335, 0.4405, 0.0535, 1, 0.4416, 0.0584, 0.4426, 0.0679,
    0.4426, 0.0754, 1, 0.4429, 0.1033, 0.4342, 0.1151, 0.4125, 0.1166, 1,
    0.4048, 0.1171, 0.4026, 0.1167, 0.3967, 0.114, 1, 0.3832, 0.1078,
    0.3796, 0.0992, 0.3785, 0.07, 2, 0.3778, 0.0503, 2, 0.3491, 0.0503, 2,
    0.3204, 0.0503, 2, 0.3204, 0.0669, 1, 0.3204, 0.0948, 0.3233, 0.1119,
    0.331, 0.1288, 1, 0.3441, 0.1573, 0.3681, 0.1723, 0.4039, 0.1742, 1,
    0.4629, 0.1774, 0.4972, 0.1482, 0.5039, 0.0892, 1, 0.5064, 0.0675,
    0.5037, 0.0414, 0.4969, 0.0214, 1, 0.4885, -0.0032, 0.4776, -0.0176,
    0.4364, -0.0584, 1, 0.4021, -0.0924, 0.3939, -0.1025, 0.3883, -0.1174,
    1, 0.3804, -0.1387, 0.3822, -0.1648, 0.3923, -0.1757, 1, 0.4003,
    -0.1842, 0.4171, -0.1867, 0.4288, -0.181, 1, 0.4407, -0.1752, 0.4449,
    -0.1644, 0.4448, -0.1398, 2, 0.4447, -0.1231, 2, 0.4742, -0.1231, 2,
    0.5038, -0.1231, 2, 0.5038, -0.1367, 1, 0.5038, -0.175, 0.4956, -0.2003,
    0.4774, -0.2187, 1, 0.4668, -0.2295, 0.4575, -0.2347, 0.4421, -0.2386,
    1, 0.4305, -0.2415, 0.4096, -0.2427, 0.3976, -0.2411, 0, -0.4083,
    -0.0339, 2, -0.4083, 0.1685, 2, -0.3483, 0.1681, 2, -0.2883, 0.1677, 2,
    -0.2764, 0.1636, 1, -0.2449, 0.1527, -0.2271, 0.129, -0.2224, 0.0916, 1,
    -0.2216, 0.085, -0.2211, 0.0384, -0.2211, -0.0353, 1, -0.2211, -0.1339,
    -0.2214, -0.1534, -0.223, -0.1628, 1, -0.227, -0.1858, -0.2337, -0.1999,
    -0.2469, -0.2131, 1, -0.257, -0.2231, -0.2663, -0.2283, -0.282, -0.2327,
    1, -0.2916, -0.2353, -0.2949, -0.2354, -0.3502, -0.2359, 2, -0.4083,
    -0.2363, 2, -0.4083, -0.0339, 0, -0.0389, -0.0339, 2, -0.039, 0.1685, 2,
    0.021, 0.1681, 2, 0.081, 0.1677, 2, 0.093, 0.1636, 1, 0.1175, 0.1551,
    0.132, 0.141, 0.1407, 0.117, 1, 0.1483, 0.0961, 0.1484, 0.0948, 0.148,
    -0.0396, 2, 0.1476, -0.1614, 2, 0.1442, -0.1737, 1, 0.1394, -0.1911,
    0.1332, -0.2023, 0.1224, -0.2131, 1, 0.1124, -0.2231, 0.1031, -0.2282,
    0.0871, -0.2327, 1, 0.0778, -0.2353, 0.074, -0.2354, 0.0192, -0.2359, 2,
    -0.0389, -0.2364, 2, -0.0389, -0.0339, 0, -0.3457, -0.1772, 1, -0.3459,
    -0.1765, -0.346, -0.1114, -0.3458, -0.0326, 2, -0.3455, 0.1107, 2,
    -0.3236, 0.1103, 2, -0.3017, 0.1099, 2, -0.2963, 0.1062, 1, -0.2925,
    0.1035, -0.2897, 0.1001, -0.2871, 0.0948, 2, -0.2833, 0.0873, 2,
    -0.2833, -0.034, 2, -0.2833, -0.1553, 2, -0.2871, -0.1627, 1, -0.29,
    -0.1684, -0.2923, -0.171, -0.297, -0.174, 1, -0.3031, -0.1777, -0.3033,
    -0.1778, -0.3242, -0.1782, 1, -0.3385, -0.1785, -0.3453, -0.1782,
    -0.3457, -0.1772, 0, 0.0239, -0.1763, 1, 0.0236, -0.1227, 0.024, 0.1099,
    0.0244, 0.1102, 1, 0.0256, 0.1114, 0.0639, 0.1106, 0.0673, 0.1093, 1,
    0.074, 0.1067, 0.0794, 0.1015, 0.0828, 0.0944, 2, 0.0861, 0.0873, 2,
    0.0864, -0.0289, 1, 0.0867, -0.1117, 0.0864, -0.1473, 0.0854, -0.1526,
    1, 0.0834, -0.1631, 0.0791, -0.1701, 0.0719, -0.1743, 1, 0.0661,
    -0.1777, 0.0653, -0.1778, 0.0449, -0.1782, 1, 0.0252, -0.1786, 0.0239,
    -0.1785, 0.0239, -0.1763
  ];

  function diamondPath(pdf, cx, cy, halfW, halfH) {
    pdf.moveTo(cx, cy - halfH);
    pdf.lineTo(cx + halfW, cy);
    pdf.lineTo(cx, cy + halfH);
    pdf.lineTo(cx - halfW, cy);
    pdf.close();
  }

  function drawLogoMark(pdf, cx, cy, size) {
    var r = size / 2;
    var rh = r * LOGO_ASPECT;

    // Band: outer diamond with the inner one knocked out, filled even-odd so
    // it stays one path with a hole rather than two stacked shapes.
    pdf.setFillColor(LOGO_GOLD[0], LOGO_GOLD[1], LOGO_GOLD[2]);
    diamondPath(pdf, cx, cy, r, rh);
    diamondPath(pdf, cx, cy, r * LOGO_INNER, rh * LOGO_INNER);
    pdf.fillEvenOdd();

    // Letters.
    pdf.setFillColor(LOGO_NAVY[0], LOGO_NAVY[1], LOGO_NAVY[2]);
    var i = 0, X = function (v) { return cx + v * r; }, Y = function (v) { return cy + v * r; };
    while (i < LOGO_LETTERS.length) {
      var op = LOGO_LETTERS[i];
      if (op === 0) { pdf.moveTo(X(LOGO_LETTERS[i + 1]), Y(LOGO_LETTERS[i + 2])); i += 3; }
      else if (op === 2) { pdf.lineTo(X(LOGO_LETTERS[i + 1]), Y(LOGO_LETTERS[i + 2])); i += 3; }
      else if (op === 1) {
        pdf.curveTo(X(LOGO_LETTERS[i + 1]), Y(LOGO_LETTERS[i + 2]),
                    X(LOGO_LETTERS[i + 3]), Y(LOGO_LETTERS[i + 4]),
                    X(LOGO_LETTERS[i + 5]), Y(LOGO_LETTERS[i + 6]));
        i += 7;
      } else { pdf.close(); i += 1; }
    }
    // Even-odd, so the enclosed subpaths punch out the counters of the two
    // D's regardless of which direction the tracer wound them.
    pdf.fillEvenOdd();
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
    // Label left, figure right — lines the amount up with the Subtotal/Total
    // column above it, and matches the payslip's Net Pay band.
    var dueH = 16;
    band(pdf, MARGIN, y, CONTENT_W, dueH, CREAM, GOLD, 2);
    setFont(pdf, 'bold', 9, NAVY);
    pdf.text('AMOUNT DUE', MARGIN + 5, y + dueH / 2 + 1.2);
    setFont(pdf, 'bold', 18, NAVY);
    pdf.text(money(inv.total), PAGE_W - MARGIN - 5, y + dueH / 2 + 2.2, { align: 'right' });
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
    dateLabel: dateLabel,
    drawLogoMark: drawLogoMark
  };
})(typeof window !== 'undefined' ? window : this);
