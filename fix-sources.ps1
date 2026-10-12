$URL = "https://drive.usercontent.google.com/download?id=1shn3HEGC9QXwuYEIU29Y4KpViSjhGem_&export=download"

# --- conspiracy.json ---
$cards = (Get-Content packages/cards/decks/in2020/conspiracy.json -Raw | ConvertFrom-Json).cards
$fixes = @{
  'ct-in2020-014' = "$URL. First branch only (`gain-any`); drops OR-branch (set collection, G6) and the x3 immunity rider. Cost added (not printed)."
  'ct-in2020-015' = "$URL. `evict 5` untargeted (board-wide); drops the handoff to an opponent's mat, the "anywhere in their turn" queue, and the between-turns anchor (G10/G22). Strictly weaker than printed; disclosed on the card's face."
  'ct-in2020-016' = "$URL. `discard-voter 4` to your own mats; drops "up to 4 zones" (G16, one zone only) and the gerrymander-rights gate. Wider than printed; disclosed on the card's face."
  'ct-in2020-017' = "$URL. Re-file of `hl-et2040-015` (Movement Anxiety Disorder) under its India name; dedupe by effect, not name. `on-gerrymander` hook with `movedMyVoter` and `until:'next-turn'`; drops "next 3" (counter, G10) and "instantly"."
}
foreach ($id in $fixes.Keys) {
  $c = $cards | Where-Object { $_.id -eq $id }
  if ($c) { $c.source = $fixes[$id]; Write-Output "conspiracy $($c.id): $($c.source.Length) chars" }
  else { Write-Output "conspiracy $id NOT FOUND" }
}
$cards | ConvertTo-Json -Depth 12 | Set-Content packages/cards/decks/in2020/conspiracy.json -Encoding utf8

# --- headline.json ---
$cards = (Get-Content packages/cards/decks/in2020/headline.json -Raw | ConvertFrom-Json).cards
$fixes = @{
  'hl-in2020-034' = "$URL. Re-file of `hl-et2040-021` (Don't Kiss The Babies) archetype's India half. `surcharge` in Funds reaches every purchase; `target:'you'` with `until:'next-turn'`. Wider than printed; disclosed on the card's face."
  'hl-in2020-035' = "$URL. `no-income` on the owner's next Ideology Card (`until:'next-turn'`); withholds the passive bonus too (wider than printed, disclosed). G18's `no-income` is read in exactly one place."
}
foreach ($id in $fixes.Keys) {
  $c = $cards | Where-Object { $_.id -eq $id }
  if ($c) { $c.source = $fixes[$id]; Write-Output "headline $($c.id): $($c.source.Length) chars" }
  else { Write-Output "headline $id NOT FOUND" }
}
$cards | ConvertTo-Json -Depth 12 | Set-Content packages/cards/decks/in2020/headline.json -Encoding utf8