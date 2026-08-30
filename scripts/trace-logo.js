/**
 * Regenerates the vector DDS mark used in the PDFs.
 *
 * public/pdf-docs.js draws the logo as vector paths so the exported PDF stays
 * fully editable. Those paths are traced from the real logo artwork by this
 * script — the diamond from its measured proportions, the DDS letterforms from
 * the artwork's own outlines. Run it only when the logo artwork itself changes.
 *
 *   npm install --no-save potrace pngjs
 *   node scripts/trace-logo.js [path/to/logo.png]
 *
 * It prints the three values to paste into the "logo" section of
 * public/pdf-docs.js: LOGO_INNER, LOGO_ASPECT and LOGO_LETTERS. Re-render a
 * payslip and an invoice afterwards and check the mark against the artwork —
 * this is the company's logo, so eyeball it rather than trusting the numbers.
 *
 * The default source is scripts/dds-logo-mark.png, kept alongside this script
 * so the committed path data can always be reproduced.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let PNG, potrace;
try {
  PNG = require('pngjs').PNG;
  potrace = require('potrace');
} catch (e) {
  console.error('Missing build-only dependencies. Run:\n\n  npm install --no-save potrace pngjs\n');
  process.exit(1);
}

const SRC = process.argv[2] || path.join(__dirname, 'dds-logo-mark.png');
if (!fs.existsSync(SRC)) {
  console.error('No such file: ' + SRC);
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = png;
const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

const isGold = p => p[3] > 128 && p[0] > 150 && p[1] > 90 && p[2] < 140 && p[0] - p[2] > 60;
const isNavy = p => p[3] > 128 && p[2] > 80 && p[0] < 110 && p[2] - p[0] > 40;

// ---- diamond geometry -----------------------------------------------------
// Scan the centre row and column: the gold runs give the outer vertices and
// the band thickness, which is all the diamond needs.
function goldRuns(fixed, vertical) {
  const runs = [];
  let start = null;
  const n = vertical ? H : W;
  for (let i = 0; i < n; i++) {
    const p = vertical ? at(fixed, i) : at(i, fixed);
    if (isGold(p)) { if (start === null) start = i; }
    else if (start !== null) { runs.push([start, i - 1]); start = null; }
  }
  if (start !== null) runs.push([start, n - 1]);
  return runs;
}

const colRuns = goldRuns(Math.round(W / 2), true);
const top = colRuns[0][0], bottom = colRuns[colRuns.length - 1][1];
const cy = Math.round((top + bottom) / 2);
const rowRuns = goldRuns(cy, false);
const left = rowRuns[0][0], right = rowRuns[rowRuns.length - 1][1];
const cx = Math.round((left + right) / 2);

const halfW = (right - left) / 2;
const halfH = (bottom - top) / 2;
const bandRun = rowRuns[0][1] - rowRuns[0][0] + 1;   // horizontal run through the band
const innerRatio = (halfW - bandRun) / halfW;
const aspect = halfH / halfW;

// ---- mean gold ------------------------------------------------------------
let gr = 0, gg = 0, gb = 0, gn = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = at(x, y);
    if (isGold(p)) { gr += p[0]; gg += p[1]; gb += p[2]; gn++; }
  }
}
const meanGold = [Math.round(gr / gn), Math.round(gg / gn), Math.round(gb / gn)];

// Darkest navy pixel is the truest letter colour (the rest is antialiasing).
let navy = [255, 255, 255];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = at(x, y);
    if (isNavy(p) && p[0] + p[1] + p[2] < navy[0] + navy[1] + navy[2]) navy = [p[0], p[1], p[2]];
  }
}

// ---- trace the letters ----------------------------------------------------
const maskPath = path.join(os.tmpdir(), 'dds-letters-mask.png');
const mask = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  const v = isNavy([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]) ? 0 : 255;
  mask.data[i * 4] = v; mask.data[i * 4 + 1] = v; mask.data[i * 4 + 2] = v; mask.data[i * 4 + 3] = 255;
}
fs.writeFileSync(maskPath, PNG.sync.write(mask));

potrace.trace(maskPath, { turdSize: 40, alphaMax: 1.0, optCurve: true, optTolerance: 0.2, threshold: 128 },
  (err, svg) => {
    fs.unlinkSync(maskPath);
    if (err) throw err;

    const d = (svg.match(/ d="([^"]+)"/) || [])[1];
    if (!d) { console.error('potrace produced no path — check the navy colour test.'); process.exit(1); }

    // Normalise against the diamond: origin at its centre, 1 unit = half-width.
    const q = v => Math.round(v * 10000) / 10000;
    const nx = x => q((x - cx) / halfW), ny = y => q((y - cy) / halfW);

    // potrace emits absolute M / L / C / Z only.
    const toks = d.match(/[MCLZmclz]|-?[\d.]+/g);
    const out = [];
    let i = 0, cmd = null;
    while (i < toks.length) {
      const t = toks[i];
      if (/[MCLZmclz]/.test(t)) { cmd = t.toUpperCase(); i++; if (cmd === 'Z') { out.push(3); continue; } }
      if (cmd === 'M') { out.push(0, nx(+toks[i]), ny(+toks[i + 1])); i += 2; cmd = 'L'; }
      else if (cmd === 'L') { out.push(2, nx(+toks[i]), ny(+toks[i + 1])); i += 2; }
      else if (cmd === 'C') {
        out.push(1, nx(+toks[i]), ny(+toks[i + 1]), nx(+toks[i + 2]), ny(+toks[i + 3]),
                 nx(+toks[i + 4]), ny(+toks[i + 5]));
        i += 6;
      } else i++;
    }

    let line = '';
    const lines = [];
    out.forEach((v, idx) => {
      const s = String(v) + (idx < out.length - 1 ? ',' : '');
      if ((line + s).length > 72) { lines.push('    ' + line.trim()); line = ''; }
      line += s + ' ';
    });
    if (line.trim()) lines.push('    ' + line.trim());

    console.log('Source: ' + SRC + '  (' + W + 'x' + H + ')');
    console.log('Diamond centre ' + cx + ',' + cy + '  half-width ' + halfW + '  half-height ' + halfH);
    console.log('');
    console.log('Paste into the logo section of public/pdf-docs.js:');
    console.log('');
    console.log('  var LOGO_INNER = ' + (Math.round(innerRatio * 10000) / 10000) + ';');
    console.log('  var LOGO_ASPECT = ' + (Math.round(aspect * 10000) / 10000) + ';');
    console.log('  var LOGO_GOLD = [' + meanGold.join(', ') + '];');
    console.log('  var LOGO_NAVY = [' + navy.join(', ') + '];');
    console.log('  var LOGO_LETTERS = [');
    console.log(lines.join('\n'));
    console.log('  ];');
  });
