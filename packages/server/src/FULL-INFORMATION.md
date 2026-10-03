# FULL INFORMATION — what changed, what was retired, and why

**The blind answer is gone.** While a card is out, every seat and every spectator sees the
whole Ideology Card — the question, both answers, both Ideologues and both payouts — before
anyone answers. The answerer sees that same card plus the means to answer it.

This file is the record of what that change retired and why. It lives here rather than in
`docs/` because the wire is what changed and this package owns the wire; every claim below
is argued in full at the file named beside it, and this is the index.

---

## 1. The one-line statement of what a field becoming public means

**Anyone can now look up every Ideology Card's payout from the public corpus.** The Ideology
deck is public JSON in this repository, so every card's payout was always one lookup away;
what the old withholding actually protected was *which* card was on the table. Under full
information that pointer no longer protects anything — a card that is on the table now has
its two payouts printed on it, and every card in the deck is dealt to somebody during the
course of a game.

So the change publishes content that was already reachable. What it costs is the GAME, not
the wire, and the cost is stated plainly because it is a real one:

> With the payout visible, a player computes the better side instead of deliberating. PLAN.md
> §9 rates payout balance as risk #2 for exactly this reason — *"if one side of a card is
> strictly better, players optimise instead of deliberating and the entire premise
> collapses."* **That risk is now permanently realised, so dominance in the corpus is worse,
> not better.** See §6 for the measurement.

---

## 2. `_pendingCard` — the ruling, and why it did NOT change

`_pendingCard` **keeps** its underscore, its place in `test/secret-inventory.ts`'s
`SECRET_FIELDS`, and its place in `scripts/check-secrets.mjs`'s `SECRET_NAMES`. The card's
content is public; its **id** is not.

That is a decision, not an oversight, and it reverses the more obvious reading of "publish
the card". Four reasons, in descending order of how much they carry:

1. **The gate.** `scripts/check-secrets.mjs` fails the build on the mere MENTION of a
   server-only field's name, in any file, comments included, and it works by the field
   being `_`-prefixed and named in `SECRET_NAMES`. That name-based grep is the ONLY
   mechanism in the repository that keeps a server-only field off the wire. Publishing the
   card by id would move that value onto an unprefixed field where no grep on that list
   covers it — and PLAN.md §9 risk #2 means the payout is precisely the field somebody might
   later want to re-hide. The gate is worth more than the convenience of a public id.
2. **The `manifestoCards` precedent does NOT transfer.** It is safe to publish an answered
   card by id because an answered card's payout has already been paid and revealed, so the
   id adds nothing. Full information deletes exactly that condition — it makes an
   *unanswered* card's payout public too — so the precedent is silent here and cannot be
   borrowed. (The previous agent's content-only ruling reached the right answer by this
   argument; it did not survive being restated, and it is re-argued above because it is the
   argument the next reader will want.)
3. **A narrower projection whose only function is to be less revealing than the broad one is
   the shape `broadcast.ts`'s own header names as the failure mode** — "second projections
   leak". `openQuestion` is not that: it is the card, in content, for everybody, because at
   a physical table the card is read aloud and belongs to the table
   (`AUTHENTIC-SHASN-REFERENCE` §7.2 step 1). What it declines to do is hand out the pointer.
4. **Nothing is gained.** The client has no card index, the payout is already on screen, and
   the id would be a lookup key into a public corpus whose contents the player already has.

**What it reveals:** the card's identity to the engine only. The card's content to everyone.
Both halves are asserted over the production broadcast in `test/secret-state.test.ts` — every
viewer receives both whole sides, and no viewer's payload contains the pending card's id.

---

## 3. What was retired, and what replaced it

Nothing was deleted silently. Every retirement below is a **rename or a rewrite onto the
property that still holds**, so that no name, type or test in the tree asserts a premise the
codebase no longer believes.

| Retired | Why its premise died | What replaced it |
|---|---|---|
| `blindPromptFor` | It returned "a prompt admitting no payout, no Ideologue, no card id" and its type was the proof. Full information makes that false. | `answerPromptFor`, same card plus the `order` draw, owed by exactly one seat. `src/broadcast.ts`. |
| `BlindPrompt` | "Its type is the security control: there is no `Delta`, no `Ideologue`… so there is nothing for a later refactor to bind into the DOM." A type carrying two payouts and still called `BlindPrompt` is a lie in a name. | `AnswerPrompt` + `AnswerSide`, with the guarantee restated on `order`. `src/protocol.ts`, `packages/client/src/net/protocol.ts`. |
| `match:state.blind` | Same reason, at the envelope. | `match:state.answer`. `src/protocol.ts`. |
| `OpenQuestion = {question, labels}` | Two strings admitted no payout, which was the client half of the old type proof. | `PublishedOpenQuestion = {question, sides}`, each side a whole printed side. `packages/client/src/app/blindWire.ts`. |
| "no payout can reach the DOM" (7 tests) | Asserted the absence of the payout. | "the whole card is on screen, and the `order` draw is not" — the positive version, plus a DOM-level check that no `order` key, `data-ideologue` or `data-pays` attribute exists. `packages/client/src/answer/blindAnswer.test.tsx`. |
| "the re-delivered prompt still carries no payout, no card id and no ideologue" | Same, for the reconnect path — including a careful whole-`Delta` frame search that was a good instrument aimed at a false claim. | The same frame search inverted: both sides' payouts ARE on the wire, in the shape the client reads, in both the answerer's prompt and the table's `openQuestion`. The card-id and seed assertions stay. `test/reconnect.test.ts`. |
| "the prompt type admits nothing that could help a player choose" (7 tests) | Was the compile-time and runtime proof of the no-payout type. | The positive version over the production broadcast, plus three new gates: no card id for any viewer, the table and answerer copies are byte-identical apart from `order`, and `order` is in exactly one of them. `test/secret-state.test.ts` LAYER 3. |

### What SURVIVED, and had to be sharpened

- **The seed-derived answer order** (PLAN.md §2 amendment A′). Unchanged in mechanism — a
  pure function of the match seed and the card id, in `broadcast.ts#orderFor`, never
  `Math.random`. But its role changed from "one of four things being withheld" to **the only
  thing being withheld**, and the measurement in §6 below is why that matters so much more
  than it used to. Asserted: distribution over the whole deck is not fixed, the seed moves
  it, it is stable across a reconnect, and `allKeys(openQuestion)` does not contain `order`
  at any depth.
- **The "two sides must render identically" gate.** Unchanged and now with teeth it did not
  have. The old rule was "no per-side styling" because the Ideologue was hidden. The
  Ideologue is now PRINTED on the card, so a stylesheet that tinted a cell by its Ideologue
  would publish which Ideologue the left-hand position holds — the A′ channel in one CSS
  rule. The rule is therefore restated in its sharpest form: **the payout differs because
  the payout differs; nothing else may.** Enforced by `blindAnswer.css`'s selector audit and
  by `getComputedStyle` equality over both cells in both panels, on a fixture whose two
  sides carry *different* Ideologues and *different* payouts so a per-side rule would show.
- **The one-commit-control rule.** Unchanged, and now more important. With the payout on
  screen, a player who believes they have committed a side and has not is a player who
  believes they have banked a resource they have not. `commitState` is still a server-derived
  prop and the component still holds no state about whether it committed.
- **UI-SPEC §9 anti-patterns 1 and 3 (count-up, card flip).** Still forbidden, and now for a
  sharper reason: there is nothing to reveal, so a reveal animation would be theatre. The
  payout is in the same frame as the answer, as prose, with no icon and no `title`.

---

## 4. The redraw — kept, and its meaning changed on the record

`docs/rules-reference.md` p13: *"pay any 4 resources to have your Ideology Card redrawn
before answering."* §7.2 step 2 says why it existed: *"Because the reading player does not
know what the card pays, the redraw is a BET, not a decision."*

**That justification is gone. The mechanic is kept**, and the ruling is on the button in
`packages/client/src/app/AnswerScreen.tsx`:

- **It is now "pay 4 for a different card"** — a priced reroll, not a bet. The copy on the
  screen says so explicitly: *"both payouts are printed, so you are buying a different
  question rather than taking a chance at this one."*
- **It is not a hint about the card** and contains no second commit affordance. It buys a
  different card, not a better answer to this one.
- **Deleting it was considered and rejected**, for a stated reason rather than a shrug: the
  engine has no legal action that returns a card to the draw pile mid-turn, so removing the
  only escape from a dominated card would leave a player holding a genuinely bad card with no
  out. Under full information a dominated card is not a rare accident but a routine event,
  which makes the reroll more load-bearing than it was, not less. It is also a rulebook
  change, and this is not the package that owns the rulebook.

---

## 5. What was retired on the ENGINE side: nothing, and why that is right

`packages/engine` is untouched. `_pendingCard` keeps its name, `PRIVATE_PLAYER_KEYS` keeps
`['conspiracies', 'ideologyCards']`, and the underscore convention keeps its meaning.

That is deliberate. The engine never knew about the wire: it has no projection of its own
beyond `playerView`, and `playerView` strips by prefix. Changing the field's name to reflect
what the *server* chose to publish would have moved a wire decision into the rules package,
and it would have broken `packages/cards/test/card-playback.test.ts`, which reads
`_pendingCard` directly. **The engine's job did not change; the server's publication
decision did.**

`playerView.ts`'s header is updated to say so, and the one thing `playerView` still derives —
`awaitingAnswer` — is unchanged.

---

## 6. The measurement that made §3's "sharpened" necessary

`npm run balance --workspace packages/cards`, against the deck as shipped:

```
cards checked         151
tolerance band        ±1 total resources (RULES.resourceCap = 12)
resource-blind lean   > 80% of decisive cards

deck "et2040" — 20 ideology cards
  ideologue side rate   capitalist 25%  supremo 25%  showstopper 25%  idealist 25%
  mean side payout     3.00   mean |A−B| gap 0.00
  resource-blind       undecidable — decisive 0, leading n/a at 0%

deck "in2020" — 56 ideology cards
  ideologue side rate   capitalist 25%  supremo 23%  showstopper 25%  idealist 27%
  mean side payout     3.01   mean |A−B| gap 0.02
  resource-blind       undecidable — decisive 1, leading idealist at 100%
```

**Dominated cards: ONE, and it is a single resource.**

```
ig-in2020-006   side 0  idealist    trust 2 + funds 2  = 4
                side 1  showstopper  media 2 + funds 1  = 3
```

Side 0 pays one more resource than side 1, so a player who can compute the optimum always
picks side 0 on this card. That is 1 of 76 cards, and it is the whole of the *magnitude*
exposure: 75 of 76 cards have sides that pay the same total, and the mean |A−B| gap across
the deck is 0.00–0.02 resources. `packages/cards` owns the fix.

**The larger finding is positional, and it is the one that matters under full information.**
Ideologue by display position, all 76 cards:

```
position 0:  capitalist 34   supremo 16   showstopper  7   idealist 19
position 1:  capitalist  4   supremo 20   showstopper 31   idealist 21
```

Position 0 holds **the Capitalists' answer in 34 of 76 cards (45%)**; position 1 holds it in
4. A balanced deck would put each Ideologue near 19 in each position. So a table that knew
which cell was side 0 would know it was the Capitalists' answer nearly half the time — and
because the Ideologue is now printed on the card, that is a channel anyone can read off the
screen in one step.

The seed-derived `order` closes it, and it is the only thing that does: with `order` uniform
the marginal for each position is 50/50 across Ideologues even though the underlying deck is
skewed. That is why the order draw was kept, why it is still server-side, and why
`PublicQuestion` refuses an `order` key at any depth rather than merely omitting it.

---

## 7. What is still secret, in one list

Unchanged and still gated by `scripts/check-secrets.mjs`:

- the four draw piles and the four discard piles (`_ideologyDraw` … `_headlineDiscard`);
- `_seed`, the PRNG cursor;
- `_idSeq`;
- the pending card's **id** — see §2;
- `PlayerState.conspiracies`, for every viewer **including its owner** (D25);
- `PlayerState.ideologyCards`, a donated Ideology Card held but not yet answered;
- the `order` draw, at the client boundary (`app/blindWire.ts` REFUSES a payload carrying it)
  and at the server boundary (`PublicQuestion` admits no such key).

## 8. What a viewer can no longer be protected from

Stated here because a record of the guardrails is only half useful without it: a player can
now read the full payout of the card in front of them and of every card that comes after, and
can compute the better side rather than argue about it. The mitigation is not a type and not
a projection — it is the corpus. `packages/cards` owns it, and §6 is the measurement that says
where to look.