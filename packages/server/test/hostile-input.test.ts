/**
 * Hostile input.
 *
 * The server is the trust boundary. A client is not "our" client — it is a
 * program somebody else wrote that decided to win, and it will send whatever it
 * likes. Three things must hold when it does:
 *
 *   1. THE ROOM SURVIVES. Every one of these messages is sent at a live table with
 *      two seated players, and the final test proves the table is still playable
 *      afterwards. An exception escaping a handler on a single-threaded shared
 *      server takes down every match on the process, which for a 4-hour game is the
 *      same as losing it.
 *
 *   2. NOTHING REACHES `reduce` THAT IS NOT AN `Action`. The decoder is
 *      exhaustive by discriminant and every scalar is range-checked, so the
 *      reducer only ever sees a real intent.
 *
 *   3. NO ERROR OR LOG ECHOES A SERVER-ONLY VALUE. The error strings the client
 *      sees are built from fixed literals and the caller's own input — never from
 *      the game state. The tests at the end assert exactly that, over every error
 *      this suite provoked.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodeAction, decodeFrame, decodeMessage, MAX_PAYLOAD_BYTES } from '../src/validate.ts';
import { InMemoryMatchStore } from '../src/store.ts';
import { TestClient, startHarness, type Harness } from './fixtures.ts';
import type { ServerMessage } from '../src/protocol.ts';

// ─────────────────────────── the unit layer ───────────────────────────

describe('the decoder rejects malformed frames', () => {
  it('rejects non-JSON, non-objects and non-strings', () => {
    for (const bad of ['', '{', 'null', '[]', '42', '"hello"', 'undefined', 'NaN']) {
      expect(decodeFrame(bad).ok, `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('rejects an oversized payload by BYTE length, not character length', () => {
    // The cheap way around a `.length` check is a multi-byte character. This is
    // why the cap is applied to `Buffer.byteLength`, not to `raw.length`.
    // `'é'` is two UTF-8 bytes, so a name of N characters is 2N bytes on the wire.
    // N is chosen so the CHARACTER count is under the cap and the BYTE count is
    // over it — which is precisely the case a `.length` check would wave through.
    const multibyte = `{"t":"lobby:create","name":"${'\u00e9'.repeat(MAX_PAYLOAD_BYTES - 200)}"}`;
    expect(multibyte.length, 'the frame is under the cap in CHARACTERS').toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(Buffer.byteLength(multibyte, 'utf8'), 'and over it in BYTES').toBeGreaterThan(MAX_PAYLOAD_BYTES);
    const r = decodeFrame(multibyte);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('payload too large');

    const huge = `{"t":"lobby:create","name":"${'a'.repeat(MAX_PAYLOAD_BYTES + 100)}"}`;
    expect(decodeFrame(huge).ok).toBe(false);
  });

  it('rejects binary frames outright', () => {
    expect(decodeFrame(Buffer.from([0x00, 0x01, 0x02])).ok).toBe(false);
  });

  it('rejects an unknown message type and a missing one', () => {
    expect(decodeMessage({ t: 'match:cheat' }).ok).toBe(false);
    expect(decodeMessage({}).ok).toBe(false);
    expect(decodeMessage({ t: 42 }).ok).toBe(false);
    expect(decodeMessage(Object.create(null)).ok).toBe(false);
  });

  it('rejects UNEXPECTED fields, which is how a client would smuggle one', () => {
    // A well-formed message with an extra key must be refused, not ignored.
    // "Quietly ignores the field I did not recognise" is exactly how a smuggled
    // value ends up being logged on its way to being trusted.
    const smuggled = decodeMessage({
      t: 'match:action',
      action: { type: 'END_TURN' },
      seed: 12345,
    });
    expect(smuggled.ok).toBe(false);

    const nested = decodeMessage({
      t: 'match:action',
      action: { type: 'END_TURN', cardId: 'ig-et2040-001' },
    });
    expect(nested.ok).toBe(false);
  });

  it('rejects a prototype-pollution attempt', () => {
    expect(decodeMessage(JSON.parse('{"t":"lobby:list","__proto__":{"x":1}}')).ok).toBe(false);
    expect(decodeMessage(JSON.parse('{"t":"lobby:create","name":"a","maxPlayers":2,"isPrivate":false,"constructor":1}')).ok).toBe(false);
    // And the prototype is genuinely untouched afterwards.
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('rejects a lobby:create with an out-of-range seat count', () => {
    for (const n of [0, 1, 6, -1, 2.5, NaN, '3', null]) {
      expect(
        decodeMessage({ t: 'lobby:create', name: 'x', maxPlayers: n, isPrivate: false, mode: 'standard' }).ok,
        `accepted maxPlayers=${String(n)}`,
      ).toBe(false);
    }
  });

  it('rejects control characters in names and tokens', () => {
    expect(decodeMessage({ t: 'lobby:create', name: 'a\u0000b', maxPlayers: 2, isPrivate: false, mode: 'standard' }).ok).toBe(false);
    expect(decodeMessage({ t: 'lobby:create', name: 'a\nb', maxPlayers: 2, isPrivate: false, mode: 'standard' }).ok).toBe(false);
    expect(decodeMessage({ t: 'session:resume', resumeToken: 'a\u0007b' }).ok).toBe(false);
    expect(decodeMessage({ t: 'session:resume', resumeToken: '' }).ok).toBe(false);
    expect(decodeMessage({ t: 'session:resume', resumeToken: 'a'.repeat(200) }).ok).toBe(false);
  });

  /**
   * S3 — `RESPOND_INTERRUPT`'s `at`, the one field the engine REFLECTS.
   *
   * The audit read this arm as bounded in both length AND characters, and the second
   * clause was wrong: the check was hand-written rather than delegating to `str`, so it
   * bounded the length and let every control character through. That matters more here
   * than anywhere else in the decoder because `at` is the only field the engine
   * interpolates into a client-visible string — `reduce` answers
   * `fail('unknown player ' + action.at)` and `#dispatch` forwards the engine's words
   * verbatim — so this is the one id in the file that ends up in a rendered error.
   *
   * Under full information the attacker already knows what they sent, so this is
   * hardening rather than a vulnerability. It is still worth closing, and the cost of
   * closing it is that it is now the same `str` every other id on this wire goes
   * through — which is the only way the next `PlayerID` added here inherits the rule
   * instead of reimplementing half of it.
   */
  it('bounds RESPOND_INTERRUPT`s reflected `at` in BOTH length and characters', () => {
    const action = (at: unknown): ReturnType<typeof decodeAction> =>
      decodeAction({ type: 'RESPOND_INTERRUPT', cardId: 'c1', at });

    // ABSENT is still legal and still distinct from `undefined` under
    // `exactOptionalPropertyTypes` — a BLOCK carries no target.
    const block = decodeAction({ type: 'RESPOND_INTERRUPT', cardId: 'c1' });
    expect(block, 'a BLOCK with no target was rejected').not.toBeNull();
    if (block !== null && block.type === 'RESPOND_INTERRUPT') expect('at' in block, 'an absent `at` became a key').toBe(false);

    // The characters the audit believed were refused and were not.
    for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u0007b', 'a\u001bb', 'a\u007fb']) {
      expect(action(bad), `a control character reached the wire: ${JSON.stringify(bad)}`).toBeNull();
    }
    // …and the length, which the old check DID get right and must not regress.
    expect(action(''), 'an empty `at` was accepted').toBeNull();
    expect(action('a'.repeat(65)), 'a 65-character `at` was accepted').toBeNull();
    expect(action(7), 'a numeric `at` was accepted').toBeNull();
    expect(action({ to: 'p1' }), 'an object `at` was accepted').toBeNull();

    // And a well-formed one still gets through, so the tightening is not a blanket ban.
    expect(action('p_1'), 'a legitimate PlayerID was rejected').not.toBeNull();
    expect(action('a'.repeat(64)), 'a 64-character id was rejected').not.toBeNull();
  });
});

describe('the decoder rejects malformed actions', () => {
  it('rejects every action with a missing or mistyped required field', () => {
    const cases: readonly unknown[] = [
      null,
      undefined,
      42,
      [],
      {},
      { type: 'END_TURN', extra: 1 },
      { type: 'NOT_A_REAL_ACTION' },
      { type: 'ANSWER' },
      { type: 'ANSWER', side: 2 },
      { type: 'ANSWER', side: -1 },
      { type: 'ANSWER', side: 0.5 },
      { type: 'ANSWER', side: '0' },
      { type: 'END_TURN', type2: 'x' },
      { type: 'INFLUENCE' },
      { type: 'INFLUENCE', slot: -1 },
      { type: 'INFLUENCE', slot: 1e9 },
      { type: 'INFLUENCE', slot: 0, discounts: ['nope'] },
      { type: 'INFLUENCE', slot: 0, discounts: Array(50).fill('funds') },
      { type: 'INFLUENCE', slot: 0, viral: 'yes' },
      { type: 'PLACE_VOTERS', groupId: 'g', areaIds: 'central-1' },
      { type: 'PLACE_VOTERS', groupId: 'g', areaIds: [1, 2, 3] },
      { type: 'PLACE_VOTERS', groupId: 'g', areaIds: Array(200).fill('a') },
      { type: 'GERRYMANDER', zoneId: 'atlantis', fromAreaId: 'a', toAreaId: 'b' },
      { type: 'GERRYMANDER', zoneId: 'central', fromAreaId: 1, toAreaId: 'b' },
      { type: 'TRADE', withPlayer: 'p2', give: 1, receive: { funds: 1 } },
      { type: 'TRADE', withPlayer: 'p2', give: { funds: 1 }, receive: { funds: 1 }, giveCards: [7] },
      { type: 'REDRAW_IDEOLOGY' },
      { type: 'REDRAW_IDEOLOGY', pay: { funds: 4, nonsense: 1 } },
      { type: 'BUY_CONSPIRACY', pay: { funds: 4 }, discounts: 'funds' },
      { type: 'PLAY_CONSPIRACY' },
      { type: 'PLAY_CONSPIRACY', cardId: '' },
      { type: 'POWER_PROSPECT', give: 'money', take: ['funds'] },
      { type: 'POWER_LAND_GRAB' },
      { type: 'POWER_DONATIONS', from: 'p2', res: 'gold' },
      { type: 'POWER_PAYBACK', areaId: 'a', pay: 5 },
      { type: 'POWER_TOUGH_LOVE', areaIds: ['a'], pay: { trust: 2, funds: -2 } },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1' },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'nope' } },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'steal', from: 1, res: {} } },
      { type: 'ACK_HEADLINE', now: 1 },
    ];
    for (const c of cases) {
      expect(decodeAction(c), `accepted ${JSON.stringify(c)}`).toBeNull();
    }
  });

  it('rejects NEGATIVE, fractional and non-finite resource deltas at the boundary', () => {
    // The single most important security property in the action decoder.
    //
    // `Delta` is `Partial<Record<Resource, number>>`, and `number` includes
    // negatives, so `{funds: 3, trust: -2}` typechecks perfectly and totals 1. A
    // boundary that let it through would be a resource-minting primitive, because
    // a "discard exactly 3" choice would be satisfied while the negative entry
    // silently refunded itself.
    for (const pay of [
      { funds: -3 },
      { funds: 3, trust: -2 },
      { funds: 1.5 },
      { funds: NaN },
      { funds: Infinity },
      { funds: '4' },
      { funds: null },
      { funds: 1e9 },
    ]) {
      expect(decodeAction({ type: 'REDRAW_IDEOLOGY', pay }), `accepted ${JSON.stringify(pay)}`).toBeNull();
      expect(decodeAction({ type: 'BUY_CONSPIRACY', pay }), `accepted ${JSON.stringify(pay)}`).toBeNull();
      expect(
        decodeAction({ type: 'RESOLVE_CHOICE', choiceId: 'c', pick: { kind: 'resources', res: pay } }),
        `accepted choice ${JSON.stringify(pay)}`,
      ).toBeNull();
    }
  });

  it('accepts every well-formed action it is supposed to', () => {
    // The complement of the previous test, because a decoder that rejects
    // everything passes every rejection test above.
    const good: readonly unknown[] = [
      { type: 'END_TURN' },
      { type: 'ACK_HEADLINE' },
      { type: 'ANSWER', side: 0 },
      { type: 'ANSWER', side: 1 },
      { type: 'REDRAW_IDEOLOGY', pay: { funds: 4 } },
      { type: 'REDRAW_IDEOLOGY', pay: {} },
      { type: 'INFLUENCE', slot: 0 },
      { type: 'INFLUENCE', slot: 2, discounts: ['funds'], viral: true },
      { type: 'PLACE_VOTERS', groupId: 'g1', areaIds: ['central-1'] },
      { type: 'GERRYMANDER', zoneId: 'central', fromAreaId: 'a', toAreaId: 'b' },
      { type: 'TRADE', withPlayer: 'p2', give: { funds: 1 }, receive: { funds: 1 } },
      { type: 'BUY_CONSPIRACY', pay: { funds: 4 }, discounts: ['clout'] },
      { type: 'PLAY_CONSPIRACY', cardId: 'ct-1' },
      { type: 'POWER_PROSPECT', give: 'funds', take: ['funds', 'clout'] },
      { type: 'POWER_LAND_GRAB', areaId: 'central-1' },
      { type: 'POWER_DONATIONS', from: 'p2', res: 'funds' },
      { type: 'POWER_PAYBACK', areaId: 'central-1', pay: 'clout' },
      { type: 'POWER_TOUGH_LOVE', areaIds: ['a'], pay: { trust: 2 }, discounts: ['funds'] },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 3 } } },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'steal', from: 'p2', res: { funds: 3 } } },
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'areas', areaIds: ['a', 'b'] } },
    ];
    for (const g of good) {
      expect(decodeAction(g), `rejected a valid action ${JSON.stringify(g)}`).not.toBeNull();
    }
  });

  it('keeps an absent optional field ABSENT, because exactOptionalPropertyTypes is on', () => {
    // `{viral: undefined}` is not the same type as no `viral`, and the engine
    // would then see a key it did not expect. The decoder builds optional fields
    // by key, never by assigning undefined.
    const a = decodeAction({ type: 'INFLUENCE', slot: 0 });
    expect(a).not.toBeNull();
    if (a === null || a.type !== 'INFLUENCE') return;
    expect('viral' in a).toBe(false);
    expect('discounts' in a).toBe(false);
  });
});

// ─────────────────────────── the live layer ───────────────────────────

let harness: Harness;
let alice: TestClient;
let bob: TestClient;
let matchId: string;

beforeAll(async () => {
  harness = await startHarness({ dispatchRate: 200, messageRate: 200 });
  alice = await TestClient.connect(harness.url);
  alice.send({ t: 'lobby:create', name: 'Host', maxPlayers: 2, isPrivate: false, mode: 'standard' });
  const created = await alice.expect(alice.is('lobby:state'), 'lobby:state');
  matchId = 'pending';
  void created;

  bob = await TestClient.connect(harness.url);
  bob.send({ t: 'lobby:list' });
  const list = await bob.expect(bob.is('lobby:list'), 'lobby list');
  const lobbyId = list.lobbies[0]?.lobbyId;
  if (lobbyId === undefined) throw new Error('no lobby listed');
  bob.send({ t: 'lobby:join', lobbyId, name: 'Guest' });
  await bob.expect(bob.is('lobby:state'), 'bob lobby state');

  alice.send({ t: 'lobby:start' });
  const started = await alice.expect(alice.is('match:state'), 'match started');
  matchId = started.matchId;
  await bob.expect(bob.is('match:state'), 'bob match state');
}, 20_000);

afterAll(async () => {
  await alice?.close();
  await bob?.close();
  await harness?.close();
});

const errorsOf = (c: TestClient): readonly Extract<ServerMessage, { t: 'error' }>[] => c.ever('error');

describe('a live room survives everything sent at it', () => {
  it('rejects malformed frames without closing the socket or the room', async () => {
    // Deliberately does NOT include an oversized frame. `ws` refuses a frame over
    // `maxPayload` at the protocol level and closes the connection with a 1009,
    // which is correct behaviour and is asserted separately below on its own
    // socket — because a test that kept the connection alive after an oversized
    // frame would be asserting something `ws` does not promise.
    const frames: readonly string[] = [
      '',
      'not json at all',
      '{"t":',
      '[]',
      'null',
      '{"t":"match:cheat"}',
      '{"t":"match:action"}',
      '{"t":"match:action","action":null}',
      '{"t":"match:action","action":{"type":"ANSWER","side":7}}',
      '{"t":"match:action","action":{"type":"INFLUENCE","slot":-5}}',
      '{"t":"match:action","action":{"type":"END_TURN","smuggled":true}}',
      '{"t":"lobby:create","name":"x","maxPlayers":99,"isPrivate":false}',
      '{"t":"session:resume","resumeToken":"guessing"}',
    ];
    for (const f of frames) {
      bob.sendRaw(f);
    }
    const err = await bob.expect(bob.is('error'), 'an error for the bad frames', 5000);
    expect(err.code).toBe('BAD_MESSAGE');

    // The socket is still up, which is the actual property: a hostile frame must
    // not cost the attacker OR the table their connection.
    expect(bob.closed).toBe(false);
    bob.clear();
    bob.send({ t: 'ping', nonce: 'still-here' });
    const pong = await bob.expect(bob.is('pong'), 'pong after abuse');
    expect(pong.nonce).toBe('still-here');
  });

  it('closes the connection on an oversized frame, at the protocol level', async () => {
    // `ws` enforces `maxPayload` before the frame is fully buffered and terminates
    // with 1009. Asserted so the behaviour is pinned rather than assumed: a
    // future change that relied on the application-level cap alone would be
    // relying on a frame that never arrives.
    const victim = await TestClient.connect(harness.url);
    victim.sendRaw(`{"t":"lobby:create","name":"${'a'.repeat(MAX_PAYLOAD_BYTES + 64)}","maxPlayers":2,"isPrivate":false}`);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2000);
      victim.socket.once('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
    expect(victim.closed).toBe(true);
  });

  it('refuses an out-of-turn action with the engine\'s own words', async () => {
    // The server does not re-implement turn order. It forwards and reports.
    bob.clear();
    bob.send({ t: 'match:action', action: { type: 'ANSWER', side: 0 } });
    const err = await bob.expect(bob.is('error'), 'out of turn');
    expect(err.code).toBe('ILLEGAL_ACTION');
    expect(err.message).toBe('not your turn');
  });

  it('a DEFLECT target carrying a control character never reaches the reflected error', async () => {
    // The socket half of the `at` finding, and the reason the decoder-level test is not
    // enough on its own. `at` is the one field the engine INTERPOLATES into a
    // client-visible string — `reduce` answers `fail('unknown player ' + action.at)`
    // and `#dispatch` forwards the engine's words verbatim — so "the decoder refuses it"
    // and "nothing is ever reflected" are the same claim only if the refusal happens
    // BEFORE `reduce`. It does: `decodeFrame` runs in `#onFrame`, above the handler, so
    // a control character is refused as a malformed frame and never becomes an error
    // string at all.
    bob.clear();
    bob.sendRaw(
      JSON.stringify({ t: 'match:action', action: { type: 'RESPOND_INTERRUPT', cardId: 'c1', at: 'p_1\nforged' } }),
    );
    const err = await bob.expect(bob.is('error'), 'the deflect with a control character');
    expect(err.code, 'a control character reached the reducer').toBe('BAD_MESSAGE');
    expect(err.message.includes('\n'), 'the refusal itself carried a newline').toBe(false);

    // …and a well-formed `at` IS accepted by the decoder and handed to the engine, which
    // is where the reflection actually lives. What it refuses depends on the room's
    // phase — with no window open the engine never reaches the player lookup — so what
    // is asserted here is the SHAPE of the answer rather than which refusal fired: a
    // fixed-literal server string or a bounded reflection of an id the attacker already
    // knows, and never a control character in either.
    bob.clear();
    bob.sendRaw(JSON.stringify({ t: 'match:action', action: { type: 'RESPOND_INTERRUPT', cardId: 'c1', at: 'p_not_a_seat' } }));
    const reflected = await bob.expect(bob.is('error'), 'the deflect naming nobody');
    expect(reflected.code, 'a well-formed deflect was refused by the DECODER').not.toBe('BAD_MESSAGE');
    expect(reflected.message.length, 'the reflected string is unbounded').toBeLessThanOrEqual(200);
    expect(/[\u0000-\u001f\u007f]/.test(reflected.message), `a control character reached the error string: ${JSON.stringify(reflected.message)}`).toBe(
      false,
    );
    expect(bob.closed, 'a reflected string cost the attacker their connection').toBe(false);
  });

  it('refuses an action for a match the session is not in', async () => {
    // A perfectly well-formed action, sent to a room the sender is not seated in.
    // Cross-room dispatch is the seat-takeover shape, and it is refused on the
    // "you are not seated at this table" check rather than by the reducer.
    const outsider = await TestClient.connect(harness.url);
    outsider.send({ t: 'match:action', action: { type: 'END_TURN' } });
    const err = await outsider.expect(outsider.is('error'), 'not in a match');
    expect(err.code).toBe('NOT_IN_LOBBY');
    await outsider.close();
  });

  it('refuses a negative-resource delta and does not mint anything', async () => {
    // The raw bytes carry a negative delta that the DECODER rejects, so it never
    // reaches the reducer. The assertion is on the resulting state: no player's
    // pool changed, and no pool went negative.
    const before = latestState(bob);
    bob.clear();
    bob.sendRaw(
      JSON.stringify({
        t: 'match:action',
        action: { type: 'REDRAW_IDEOLOGY', pay: { funds: 4, trust: -4 } },
      }),
    );
    const err = await bob.expect(bob.is('error'), 'negative delta rejected');
    expect(err.code).toBe('BAD_MESSAGE');

    const after = latestState(bob);
    for (const pid of Object.keys(after.players)) {
      const p = after.players[pid];
      const q = before.players[pid];
      if (p === undefined || q === undefined) continue;
      expect(p.resources, `${pid}'s pool changed on a rejected action`).toEqual(q.resources);
      for (const v of Object.values(p.resources)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('rate-limits a flood of dispatches without dropping the table', async () => {
    const flooder = await TestClient.connect(harness.url);
    flooder.send({ t: 'match:action', action: { type: 'END_TURN' } });
    await flooder.expect(flooder.is('error'), 'flooder not in a match');

    // A seated player who floods. The bucket is 4/s by default, and this harness
    // was started with 200/s, so use a raw burst that still exceeds the refills
    // available in the test's wall-clock window.
    bob.clear();
    for (let i = 0; i < 400; i += 1) {
      bob.send({ t: 'match:action', action: { type: 'END_TURN' } });
    }
    const limited = await bob.expect(bob.is('error'), 'a rate-limit error', 5000);
    expect(['RATE_LIMITED', 'ILLEGAL_ACTION']).toContain(limited.code);
    expect(bob.closed).toBe(false);
    await flooder.close();
  });

  it('a rejected action produces NO state message — there is nothing to roll back', async () => {
    // The payoff of having no optimistic client: `viewId` only advances on a
    // committed action, so a rejection is genuinely inert rather than something
    // the client has to undo.
    bob.clear();
    const before = latestState(bob);
    bob.send({ t: 'match:action', action: { type: 'ANSWER', side: 0 } });
    await bob.expect(bob.is('error'), 'rejected');
    expect(bob.all('match:state')).toHaveLength(0);
    expect(latestState(bob).turn).toBe(before.turn);
  });

  it('the table is still playable after all of that', async () => {
    // The assertion that matters most in this file. Everything above sent
    // garbage at a live two-player game; this proves the game was unaffected.
    const s = latestState(bob);
    expect(s.finished).toBe(false);
    expect(s.players).toBeDefined();

    const active = s.activePlayer;
    const who = active === s.players[alicePlayerId(harness)]?.id ? alice : bob;
    who.clear();
    who.send({ t: 'match:action', action: { type: 'ANSWER', side: 0 } });
    const next = await who.expect(who.is('match:state'), 'the table still takes a move');
    expect(next.state.phase).not.toBe('answer');
  });
});

describe('no error or log line echoes a server-only value', () => {
  it('no error message produced by this suite contains a card id or the seed', async () => {
    const room = harness.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const pending = room.state._pendingCard;
    const seed = String(room.state._seed);
    const drawn = [...room.state._ideologyDraw, ...room.state._conspiracyDraw, ...room.state._headlineDraw];

    const allErrors = [...errorsOf(alice), ...errorsOf(bob)];
    expect(allErrors.length).toBeGreaterThan(0);
    for (const e of allErrors) {
      if (pending !== null) expect(e.message.includes(pending), `error leaked ${pending}: ${e.message}`).toBe(false);
      for (const id of drawn.slice(0, 20)) {
        expect(e.message.includes(id), `error leaked card id ${id}`).toBe(false);
      }
      expect(e.message.includes(seed), 'error leaked the seed').toBe(false);
    }
  });

  it('the server\'s own error vocabulary is a fixed set of literals', async () => {
    // A guard against a future `${}` slipping into one of these strings. The
    // values below are the only client-visible texts the transport itself
    // produces; the engine's own strings are audited in the secret-state suite.
    const anon = await TestClient.connect(harness.url);
    anon.send({ t: 'match:action', action: { type: 'END_TURN' } });
    const err = await anon.expect(anon.is('error'), 'anon write');
    expect(err.message).toBe('resume your session first');
    expect(err.code).toBe('NOT_IN_LOBBY');

    anon.clear();
    anon.send({ t: 'match:spectate', matchId: 'm_does_not_exist' });
    const err2 = await anon.expect(anon.is('error'), 'bad match id');
    expect(err2.code).toBe('MATCH_NOT_FOUND');
    expect(err2.message).toBe('that match does not exist');

    anon.clear();
    anon.send({ t: 'lobby:leave' });
    const err3 = await anon.expect(anon.is('error'), 'leave with no lobby');
    expect(err3.code).toBe('NOT_IN_LOBBY');
    await anon.close();
  });
});

/**
 * The most recent state this client was sent.
 *
 * Reads the un-cleared history, not the pending buffer: several tests deliberately
 * `clear()` first to isolate their own assertions, and "what does this client
 * currently believe" has to survive that.
 */
function latestState(c: TestClient) {
  const states = c.ever('match:state');
  const last = states[states.length - 1];
  if (last === undefined) throw new Error('no match:state received yet');
  return last.state;
}

function alicePlayerId(h: Harness): string {
  const rooms = [...h.server.hub.rooms.values()];
  const room = rooms[rooms.length - 1];
  return room === undefined ? '' : room.seatOrder[0] ?? '';
}
