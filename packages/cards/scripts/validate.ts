/**
 * `npm run validate` — the CI gate.
 *
 * Exit 0 when the corpus is clean, 1 on any error. Warnings do not fail the
 * build. Every problem is reported with the file, the card id and a JSON pointer
 * so a failure is directly actionable.
 */

import { relative } from 'node:path';

import { validateCorpus } from '../src/validate.js';

const root = process.cwd();

function rel(p: string | null): string {
  if (p === null) return '(corpus)';
  const r = relative(root, p);
  return r.startsWith('..') ? p : r;
}

const report = validateCorpus();

const counts = report.counts;
const prov = report.provenance;

console.log('shasn cards — validate');
console.log('─'.repeat(72));
console.log(
  `deck files      ${report.files}`,
);
console.log(
  `cards           ${counts.total}  ` +
    `(ideology ${counts.ideology}, voter ${counts.voter}, conspiracy ${counts.conspiracy}, headline ${counts.headline})`,
);
console.log(
  `provenance      verbatim ${prov.verbatim}, adapted ${prov.adapted}, inferred ${prov.inferred}`,
);
console.log('─'.repeat(72));

if (report.findings.length === 0) {
  console.log('OK — no findings.');
  process.exit(0);
}

for (const f of report.errors) {
  console.log(`ERROR  ${f.code}  ${rel(f.file)}`);
  console.log(`       card: ${f.cardId ?? '(file level)'}`);
  console.log(`       ${f.message}`);
}
for (const f of report.warnings) {
  console.log(`warn   ${f.code}  ${rel(f.file)}  ${f.cardId ?? ''}`);
  console.log(`       ${f.message}`);
}

console.log('─'.repeat(72));
console.log(`${report.errors.length} error(s), ${report.warnings.length} warning(s).`);
process.exit(report.errors.length > 0 ? 1 : 0);
