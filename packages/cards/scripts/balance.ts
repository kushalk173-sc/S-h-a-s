/**
 * `npm run balance` — the balance checker CLI.
 *
 * Exit 1 on any dominance ERROR. Warnings alone do not fail the build unless
 * `--strict` is passed, because the warnings are the design-review checklist
 * rather than defects (docs/ARCHITECTURE.md 6.4.2).
 */

import { loadConspiracyDeck, loadHeadlineDeck, loadIdeologyDeck, loadVoterDeck } from '../src/corpus.js';
import type { XCardLike } from '../src/balance.js';
import {
  BALANCE_TOLERANCE_TOTAL,
  PAYOUT_DECIDED_SHARE_THRESHOLD,
  RESOURCE_BLIND_LEAN_THRESHOLD,
  X_EFFECT_MAGNITUDE_BUDGET,
  balanceCorpus,
} from '../src/balance.js';
import { RULES } from '../src/engine.js';

const strict = process.argv.includes('--strict');

const decks = ['core', 'et2040', 'in2020'];
const ideology = new Map<string, ReturnType<typeof loadIdeologyDeck>>();
const voter = new Map<string, ReturnType<typeof loadVoterDeck>>();
const x = new Map<string, XCardLike[]>();
for (const d of decks) {
  const i = loadIdeologyDeck(d);
  const v = loadVoterDeck(d);
  // A deck that ships no cards of a kind is not an error here; the validator owns that.
  if (i.length > 0) ideology.set(d, i);
  if (v.length > 0) voter.set(d, v);
  const c = loadConspiracyDeck(d);
  const h = loadHeadlineDeck(d);
  if (c.length + h.length > 0) x.set(d, [...c, ...h]);
}

const report = balanceCorpus({ ideology, voter, x });

console.log('shasn cards — balance');
console.log('─'.repeat(72));
console.log(`cards checked         ${report.cardsChecked}`);
console.log(
  `THE AXIS               mix vs what you can spend, over all ${RULES.resourceCap}-cap holdings ` +
    `(see src/holdings.ts). A card is COMPOSITION_DOMINANT when one side converts to`,
);
console.log(
  `                      strictly more score at EVERY reachable position — that is the check that`,
);
console.log(`                      decides answers. Total skew is reported, not enforced.`);
console.log(
  `total skew band       ±${BALANCE_TOLERANCE_TOTAL}, REPORTED not enforced: 99.4% of skew-1 pairs ` +
    `have a holding where the smaller side wins`,
);
console.log(
  `payout-decided deck    > ${(PAYOUT_DECIDED_SHARE_THRESHOLD * 100).toFixed(0)}% of cards decided by payout alone`,
);
console.log(`resource-blind lean   > ${(RESOURCE_BLIND_LEAN_THRESHOLD * 100).toFixed(0)}% of decisive cards`);
console.log(
  `x-card magnitude       > ${X_EFFECT_MAGNITUDE_BUDGET} resources to the resolving player ` +
    `(resource cap ${RULES.resourceCap})`,
);
console.log('');

for (const b of report.bias) {
  console.log(`deck "${b.deck}" — ${b.ideologyCards} ideology cards`);
  console.log(
    `  ideologue side rate   ` +
      (['capitalist', 'supremo', 'showstopper', 'idealist'] as const)
        .map((i) => `${i} ${(b.ideologueSideRate[i] * 100).toFixed(0)}%`)
        .join('  '),
  );
  console.log(
    `  ideologue pairs      ` +
      Object.entries(b.pairRate)
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, n]) => `${k} ${n}`)
        .join('  '),
  );
  console.log(
    `  mean side payout     ${b.meanSidePayout.toFixed(2)}   mean |A−B| gap ${b.meanSideGap.toFixed(2)}`,
  );
  const rb = b.resourceBlind;
  console.log(
    `  resource-blind       ${rb.verdict} — decisive ${rb.decisive}, leading ${rb.leadingIdeologue ?? 'n/a'} at ${(rb.leadShare * 100).toFixed(0)}% ` +
      `(` +
      (['capitalist', 'supremo', 'showstopper', 'idealist'] as const)
        .map((i) => `${i.slice(0, 4)} ${rb.byIdeologue[i]}`)
        .join('/') +
      `)`,
  );
  const c = b.composition;
  console.log(
    `  THE REAL AXIS        ${c.realChoice} of ${b.ideologyCards} cards leave a real choice, ` +
      `${c.decidedByPayout} decided by payout, ${c.indistinguishable} worth the same everywhere`,
  );
  console.log(
    `  holdings sweep       all ${c.positions} reachable positions per card; ` +
      `${(c.tieShare * 100).toFixed(1)}% of (card, position) pairs are ties`,
  );
  console.log('');
}

if (report.findings.length === 0) {
  console.log('OK — no findings.');
  process.exit(0);
}

for (const f of report.findings) {
  const tag = f.severity === 'error' ? 'ERROR ' : 'warn ';
  console.log(`${tag}${f.code}  [${f.deck}] ${f.cardId}`);
  console.log(`       ${f.message}`);
}

console.log('─'.repeat(72));
const failed = report.errors.length > 0 || (strict && report.warnings.length > 0);
console.log(
  `${report.errors.length} error(s), ${report.warnings.length} warning(s)${strict ? ' (--strict)' : ''}.`,
);
process.exit(failed ? 1 : 0);
