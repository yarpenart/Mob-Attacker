# Workflow audit — 2026-10-26

Reviewed release: **0.5.4**. Corrections: **0.5.5**.

## Result and limits

**142 automated tests pass**, including a test run from the installation ZIP. These exercise the actual module code with Foundry/dnd5e fixtures, including recursive in-place document flag updates. They do not run a licensed Foundry server or a live Forge world. Native UI rendering, real system hook dispatch, and interaction with other installed modules still need an in-game check. Passing the tests is not proof that every Foundry setup works.

## Findings corrected

| Finding | Reproduction and correction |
|---|---|
| Stale HP caps when returning to statblock HP | Recursive updates retained the old rolled `maxima` array. A later sync changed 21 max HP back to 14. Explicit replacement arrays keep the new caps stable. |
| Wrong average HP after splitting rolled members | A rolled 3-HP singleton could build eight members with 24 max HP instead of the Goblin statblock’s 56. Original statblock HP is retained separately from rolled member caps. |
| Incomplete failed-split rollback | In-place flag mutation changed the original snapshot; even after restoring count, a stale one-member cap could collapse max HP on the next sync. Snapshots are cloned, fixed caps normalized, and combat session/recovery metadata restored. |
| Borrowing an unavailable attack from another sheet | If the active Horde NPC lacked an equivalent item/activity, the old sheet’s attack was still used. This now gives a clear error without damage or progress. Identical NPCs can still share one open sheet. |
| Old save data crossing scope or composition | A native damage dialog completed in a different encounter could be attached to its new scope. Capture and recheck the original scope; reject expired forms before HP mutation, and reject cards whose creature IDs changed even if HP/count match. |

The initial five failure cases were reproduced before correction. Additional regression tests cover expired save forms and replacement members.

## Checklist against the conversation

“Pass” below means automated/code verification, not a live game test.

| Requested behavior | Status / evidence |
|---|---|
| Mob table thresholds, target AC and native damage without a fabricated d20 | Pass — `logic.test.mjs`, `integration.test.mjs`. |
| Progress follows initiative/target rather than the open card | Pass — same-sheet attacks follow the active NPC and consume that combatant’s slots. Missing equivalent attacks are rejected. |
| Repeated card clicks cannot produce unlimited damage | Pass — turn quotas, duplicate detection and ordinary damage-button interception. |
| Multiattack’s second attack contributes to the same progress | Pass — shared target bucket, separate spent turn slots. |
| New rounds retain partial progress | Pass — includes ten creatures needing a natural 20 reaching a hit in the second round. |
| Force hit rolls damage once and resets target progress | Pass — also consumes a slot and cannot be spammed. |
| Chat commands and manually entered attacks | Pass for `/horde BONUS | DAMAGE | COUNT | ATTACKS | NAME` and explicitly marked `/r 1d20+BONUS #horde | DAMAGE`. Unmarked plain `/r` is intentionally passed through; arbitrary chat text is not automatically recognized as an attack. |
| Normal sheet weapons, attack spells and attack abilities | The native attack activity hooks and fixtures are covered. Arbitrary third-party macros/custom activity types need live integration checks. |
| GM-only rule results and chosen native damage visibility | Pass — stored message recipients, not only CSS hiding. |
| Quick selected-token Horde marking | Pass — batch marking/unmarking and mixed selections. |
| One Horde menu on sheet/HUD; right-click initiative opens full menu | Pass in DOM fixtures. Actual sheet placement and token HUD rendering need live visual confirmation. |
| Confirmation before enabling AND disabling via initiative button | Pass — cancel/close/default cancellation, duplicate clicks and stale prompts; tracker batch toggle is covered too. |
| Population multiplies HP; original population stays recorded | Pass — scales once, changes count without compounded HP, retains damage and initial population. |
| Default statblock HP versus optional per-member rolled HP | Pass — formulas, sums, explicit reroll, preservation across split/merge and return to statblock HP. |
| Damage takes lowest current HP members first | Pass — unsorted wounds and different maximum HP. |
| Token and actor size follows living population | Pass — all Small/Medium/Large threshold settings and footprint defaults. |
| Split uses equal/random HP while conserving total and respecting caps | Pass — fixed and varied rolled caps, wounds, bounds and casualty counts. |
| Merge uses highest, upper median or lowest initiative | Pass — even/odd counts, null initiatives, fractions and active-turn preservation. |
| Split uses shared initiative or restores individual results | Pass — first missing results roll, subsequent split/merge cycles restore, new encounters discard saved results. |
| Split/merge does not grant free attacks | Pass — spent slots and existing progress are retained. |
| Split/merge locks do not bind creatures to old Horde numbers | Pass — stale lock recovery, live exclusivity, reversed Horde 1/2 merge order and conservation of all 16 members/HP. |
| Scene numbering: individuals 1–16, separate Horde numbers, stable remaining labels | Pass — free-number allocation, independent scenes, mixed subsets and no historical world-counter inflation. |
| Optional custom templates/adjectives and Horde suffix | Pass — formatting, collision handling, stable adjectives and migration. |
| Grouped settings and PL/EN labels | Pass — GM-only menus, threshold/template validation and matching language keys. |
| Saves use mob table, manual DC and forced successes | Pass — boundaries, shared progress and forced counts. |
| Fireball-like damage, success/failure shares, resistance rounding and once-only application | Pass — native/manual damage linking, stale HP/scope/composition checks and durable application lock. |
| Memory belongs to a specific encounter | Pass for restart/deletion/session tests. Current physical token wounds/caps/population remain after combat; encounter snapshots, stored initiatives and counters are discarded. |
| Private combat summary, disable setting and separate unit types | Pass — unique creature IDs survive split/merge; rows include total/survived/killed for Goblin/Giant Toad/Skeleton. Killed means tracked creatures at zero HP, not merely a deleted token. |
| Readability in light and dark modes | Palette contrast, focus/scrolling rules and structure pass automated checks. Live rendering with the user’s actual theme and modules remains unverified. |

## Suggested live smoke test

1. Update to 0.5.5 and reload GM/player clients. Test in a copy of the scene.
2. Use one Goblin sheet across three initiative entries against one target; verify progress, Multiattack, Force hit and round carry-over.
3. Make two eight-member Hordes with rolled HP. Split both, merge the former second group first, then the former first. Check names, HP sums, sizes and restored initiatives.
4. Apply a spell save and its damage once. End the encounter and verify the private report; start another and ensure old cards/progress/initiatives cannot be reused.
5. Check HUD/sheet/initiative controls and dialogs in both themes; test ordinary attacks from any other installed activity or automation modules.
