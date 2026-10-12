// Quick script to find which seeds open a response window at all seat counts
// Run with: node find-reachable-seed.js

const { loadCtx } = require('./src/index.ts');
const { freshShippedCorpus, startHarness, TestClient } = require('./test/driver.ts');

const ctx = loadCtx();
const SEATS = [2, 3, 4, 5];

async function testSeed(seed, seat) {
  const corpus = freshShippedCorpus(seed);
  const h = await startHarness({ modeCards: { standard: corpus, azadi: corpus } });
  const clients = [];
  try {
    const host = await TestClient.connect(h.url);
    clients.push(host);
    host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: seat, isPrivate: false, mode: 'standard' });
    await host.expect(host.is('lobby:state'), 'a lobby');
    for (let i = 1; i < seat; i++) {
      const guest = await TestClient.connect(h.url);
      clients.push(guest);
      guest.send({ t: 'lobby:join', lobbyId: host.lobby.lobbyId, name: `Player${i}` });
      await guest.expect(guest.is('lobby:state'), 'guest lobby');
    }
    host.send({ t: 'lobby:start' });
    const state = await host.expect(host.is('match:state'), `match:state for seed ${seed}`);
    const opened = state.state.windows?.opened?.size || 0;
    return opened > 0;
  } catch (e) {
    return false;
  } finally {
    for (const c of clients) await c.close();
    await h.close();
  }
}

async function main() {
  const results = {};
  for (const seat of SEATS) {
    results[seat] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const opened = await testSeed(seed, seat);
      if (opened) results[seat].push(seed);
      process.stdout.write('.');
    }
    console.log(`\nSeat ${seat}: ${results[seat].length} seeds open a window: ${results[seat].join(', ')}`);
  }
  
  // Find seeds that work at all four seat counts
  const worksAtAllSeats = [];
  for (const seed of results[2]) {
    let works = true;
    for (const s of SEATS) {
      if (!results[s].includes(seed)) {
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
  }
}

main().catch(console.error);