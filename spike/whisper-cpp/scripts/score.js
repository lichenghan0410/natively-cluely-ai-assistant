/**
 * CER scorer — byte-for-byte identical normalization + Levenshtein to the
 * Medium acceptance harness (test/harness.js), so whisper.cpp CER is directly
 * comparable to the ADR-002 Medium numbers.
 *
 * Usage: node score.js "<groundTruthText>" "<hypothesisText>"
 *   -> prints JSON { cer, cerPct, editDistance, refLen, hypLen }
 * Or:    node score.js --file <gtPath> <hypPath>
 */
const fs = require('fs');

function normalizeJa(s) {
  return s
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[、。，．,.?？!！「」『』（）()・〜~\-—…]/g, '')
    .toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1), curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function computeCER(reference, hypothesis) {
  const ref = normalizeJa(reference), hyp = normalizeJa(hypothesis);
  const dist = levenshtein(ref, hyp);
  return { cer: ref.length === 0 ? 0 : dist / ref.length, editDistance: dist, refLen: ref.length, hypLen: hyp.length };
}

const args = process.argv.slice(2);
let gt, hyp;
if (args[0] === '--file') { gt = fs.readFileSync(args[1], 'utf-8'); hyp = fs.readFileSync(args[2], 'utf-8'); }
else { gt = args[0] || ''; hyp = args[1] || ''; }
const r = computeCER(gt.trim(), hyp.trim());
r.cerPct = +(r.cer * 100).toFixed(2);
console.log(JSON.stringify(r));
