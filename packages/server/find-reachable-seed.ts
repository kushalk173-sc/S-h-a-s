// Sweep seeds 1..120 at all four seat counts to find which seeds open a response window.
// Run with: npx tsx find-reachable-seed.ts
// From: packages/server/

import { loadCtx } from './src/index.ts';
import { freshShippedCorpus, playInProcess } from './test/driver.ts';
import type { Ctx } from '@shasn/engine';

const ctx = loadCtx();
const SEATS = [2, 3, 4, 5] as const;

function testSeed(seed: number, n: number): boolean {
  const start = freshShippedCorpus(seed, n, ctx);
  const run = playInProcess(start, ctx, { maxActions: 1200 });
  return run.windows.opened.size > 0;
}

async function main() {
  const results: Record<number, number[]> = {};
  for (const n of SEATS) {
    results[n] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const opened = testSeed(seed, n);
      if (opened) results[n].push(seed);
      process.stdout.write('.');
    }
    console.log(`\nSeat ${n}: ${results[n].length} seeds open a window: ${results[n].join(', ')}`);
  }

  // Find seeds that work at all four seat counts
  const worksAtAllSeats: number[] = [];
  for (const seed of results[2]) {
    let works = true;
    for (const n of SEATS) {
      if (!results[n].includes(seed)) {
        works = false;
        break;
      }
    }
    if (works) worksAtAllSeats.push(seed);
  }

  console.log('\n=== SEEDS THAT WORK AT ALL FOUR SEAT COUNTS ===');
  console.log(`Total: ${worksAtAllSeats.length}`);
  console.log(`Seeds: ${worksAtAllSeats.join(', ')}`);

  if (worksAtAllSeats.length > 0) {
    const lowest = worksAtAllSeats[0];
    console.log(`\nNEW PINNED SEED: ${lowest}`);
    console.log('Update the header comment and the REACHABILITY_SEED constant in corpus-response-window.test.ts');
  } else {
    console.log('\nNO seed works at all four seat counts. The reachability argument is now FALSE.');
    console.log('The header must be updated to reflect this finding.');
  }
}

main().catch(console.error);