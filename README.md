# YarpenArt: Mob Attacker — 0.5.4

A **Foundry VTT v14 / D&D5e 5.3.3** module for running groups of NPCs with the 2014 Mob Attacks table. It counts hits, rolls native activity damage, manages Horde population HP and size, resolves group saving throws, and splits a Horde into individual tokens. Requires **libWrapper**. Dice So Nice is optional.

The interface supports **English (default)** and **Polish**, selectable in the module settings.

## Installation

Install or update using this manifest URL:

```text
https://github.com/yarpenart/Mob-Attacker/releases/latest/download/module.json
```

Alternatively, extract the `yarpenart-mob-attacker` folder into `Data/modules/`, or use the Forge module import workflow. Enable libWrapper and this module, then reload the world.

Releases are published manually with `module.json` and `mob-attacker.zip` attached. The repository contains no automatic release workflow.

## What changed in 0.5.4

Left-clicking a combat tracker Horde button requires explicit confirmation before either enabling or disabling Horde membership. Cancel is the default; closing the dialog also leaves membership unchanged. The tracker’s selected-token toggle uses the same safeguard. Duplicate clicks share one pending prompt per token, and an outdated prompt cannot undo a newer membership change. Right-click still opens the full Horde menu.

## What changed in 0.5.3

The private GM combat summary now includes a table by base creature type (for example Goblin, Giant Toad and Skeleton), with total, survived and killed in each row. Different numbered Hordes and split members of the same creature type are combined. The overall totals and the setting to disable summaries are retained.

## What changed in 0.5.2

Fixed stale split/merge flags blocking later operations with “A selected token is already being split or merged”. Active operations now acquire an in-memory guard for all selected tokens before any asynchronous work. Legacy boolean flags on completed operations are cleared automatically when retrying, including after a reload. Horde numbers are display labels, not ownership or lock keys: splitting Hordes 1 and 2, merging the former 2 as Horde 1, then merging the former 1 as Horde 2 is covered by a full token/HP regression test. A genuinely interrupted operation with both source tokens and a partial result still present retains its recovery snapshots and reports the specific condition rather than allowing duplicate creatures or HP.

## What changed in 0.5.1

- Default map names use `Goblin 1` through `Goblin 16` for two splits of eight. New names use the lowest free member numbers on this scene, separately for each base NPC. Existing members keep their numbers when others merge or disappear.
- Horde numbers have a separate pool. Merging Goblins 6–13 produces `Goblin 1 (Horde)` if number 1 is free; merging the remaining 1–5 and 14–16 produces `Goblin 2 (Horde)`. Historical counters and other scenes no longer increase these numbers.
- On the first upgrade, existing Horde numbers are compacted and the old default naming choices switch to map numbering. Existing individual names and custom/adjective settings are retained.
- The Split/Merge button now delegates all selected members to the same validation, accepting numeric and stored string counts consistently. Split copies have independent HP pools and discard old merge state; population hooks ignore an in-progress split. Different rolled HP caps remain supported.
- Damage removes HP from the weakest living member first, based on current HP rather than maximum HP or token order.
- Individual initiative results follow members through split/merge for this encounter. Later splits restore known results and roll only missing ones.
- Encounter memory and save results expire when combat ends. A private GM summary reports unique creatures, killed and surviving, with a module setting to disable it.
- Rolled HP and grouped settings from 0.5.0 are retained. Default HP still uses the value written in the NPC statblock, normally its average HP.

## Naming settings

Open **Configure Settings → YarpenArt: Mob Attacker → Horde and member naming**.

For individual members, choose Horde.member numbering, a continuous sequence, or a custom template. Enable **Add a random adjective** to prefix names such as `Angry Goblin 1.2`. Custom templates support:

| Placeholder | Meaning |
|---|---|
| `{name}` | Original base creature name |
| `{horde}` | Horde number on this scene |
| `{member}` | Member number within this split |
| `{number}` | Lowest free member number for this base NPC on this scene |
| `{adjective}` | Random adjective from your configured list |

Examples: `{name} {horde}.{member}`, `{name} {number}`, or `{adjective} {name}`. Adjective-only/custom names that collide on the scene receive an extra numeric suffix. Supply your own adjectives separated by commas or new lines; a blank list uses built-in English/Polish words.

Horde naming can stay plain (`Goblin (Horde)`), add a group number (`Goblin 2 (Horde)`), use an adjective, or use a custom template. Multi-member names always retain `(Horde)`. Existing Horde names update when naming settings are saved; already split individuals keep their assigned names until another split. Assigned adjectives do not change randomly on reload.

Numbers are allocated from live scene tokens, not a world history counter. Deleted or merged member numbers become available to new split members; existing tokens are never automatically renumbered. Horde numbers are independent of member numbers. Optional Horde.member/custom/adjective modes remain available. In Horde.member mode, split group IDs remain reserved while their individual members are on the scene, to avoid duplicate group/member names.

## Encounter memory and GM summary

Attack/save progress survives round changes within one encounter. Individual initiative results, HP snapshots and split/merge provenance are bound to that Combat session, survive a client reload, and are discarded when the encounter is ended/deleted or reset to round zero. Pending old save cards expire and cannot apply damage in a later encounter. Current token HP, member caps, wounds and population remain the physical state after the battle; ending combat does not heal creatures.

When combat ends, **Private Horde combat summary** (enabled by default in module settings) whispers all GMs the total unique creatures, killed (currently zero HP), and survivors. Split and merge preserve creature IDs and never double-count them. Creatures entering later are included; creatures already dead when they enter a new encounter are not counted again.

## Optional rolled maximum HP

Open **HP, split and merge rules → New Horde maximum HP**. The default is the HP value written in the original NPC statblock, normally its average HP, multiplied by population. It does not maximize the dice formula. **Roll maximum HP for each member** evaluates the NPC's HP formula separately for every member and sums the results; an optional custom formula overrides the NPC formula.

Results are stored, not rerolled on attacks, HP edits, healing, or reload. The Horde configuration can also explicitly **Reroll member maximum HP now** while retaining damage. Stored maxima are visible in that configuration. Splitting keeps each living member's rolled maximum and distributes current HP without exceeding those individual caps. Merging same-NPC members with different rolled maxima preserves their sum and individual limits instead of rerolling them.

With stored individual HP, casualties and healing use the tracked member pools. This keeps wounded individuals alive until their own HP is depleted; the initial population remains recorded. Rolling new maximum HP does not change the NPC's shared world actor.

## What changed in 0.4.3

Fixed immediate remerging after splitting. Compatibility now uses the base NPC actor identity rather than synthetic actor display names, which can differ between numbered split members. Equivalent numeric/string attack limits are normalized. The stored base creature name is retained when remerging, so the resulting token remains `Goblin (Horde)` rather than acquiring a member number. Distinct base creatures, base sizes, or attack limits remain incompatible, with more specific error messages.

## What changed in 0.4.2

**Split Horde: initiative** is a world setting with **Keep shared initiative** (default) and **Individual initiatives: restore saved or roll missing**. The second mode restores each member’s previously recorded initiative from this combat; only members without a result receive a native Foundry/system roll, including the retained original token when needed. The active combatant and spent attack slots are preserved. Splitting outside combat does not create combat entries or start a fight.

## What changed in 0.4.1

**Merged Horde initiative** is a world setting with **Highest**, **Median** (default), and **Lowest** options. It uses the rolled initiatives of the selected creatures in each combat. Unrolled entries are ignored; if none have rolled, the Horde stays unrolled. For an even number of results, median uses the higher of the two middle values, without averaging. For example, `15, 12, 10, 7, 5, 1` produces `10`. Splitting again follows the separate Split Horde: initiative setting.

## What changed in 0.4.0

The former Split Horde control is now **Split/Merge Horde**. Select multiple individual NPC tokens of the same creature and click it to merge them into one Horde; use it on a multi-member Horde to split it again. The action is available on the Token toolbar and inside the single Horde menu on the token HUD or NPC sheet. Right-click the initiative Horde button to open the same complete menu; left-click still toggles membership.

Merging adds current HP and base maximum HP, retains the active selected combatant (or the clicked token), and uses the configured highest/median/lowest initiative of the merged combatants. The other selected tokens and their initiative entries are replaced by the retained Horde. Existing target progress is not reset. If any member has spent an attack slot this round, that slot remains spent for the merged Horde; merging does not grant free attacks.

Only living individual NPCs on the same scene, with the same actor, base size, and attack limit can merge. The retained token supplies the resulting actor's items, resources, and effects; different stat blocks are not combined. Temporary HP is summed into the shared pool.

Merged wounded creatures retain their individual wounds internally, so two goblins at 1 HP remain two members with 2 HP total. Subsequent damage drains members in ascending current HP order; healing fills living members' wounds before restoring fallen members. Splitting uses the configured equal/random distribution and preserves the total HP and living count. Manually changing the population count rebuilds the member pools and retains the total damage already taken.

## What changed in 0.3.1

Tokens representing more than one living creature are named **Base creature name (Horde)**, and their initiative entries use the same name. The suffix is removed when one or zero members remain, when Horde is disabled, or when the group splits into individual tokens. Existing initialized Hordes are renamed on world reload. The shared actor's name is unchanged.

## What changed in 0.3.0

- Independent world settings control the creature counts required for each token size, based on the original creature being Small, Medium, or Large.
- **Split Horde** converts a token into one token per living member, retaining total current HP, the original initiative, and already spent attack slots.
- Choose equal or random HP distribution in module settings. Random distribution assigns 1 to the member's base maximum HP while preserving the original total.
- The NPC sheet has one **Horde** button before the source/XP information. It opens Configure Horde, Force hit, Horde saving throw, and Split/Merge Horde.
- Repository documentation and release descriptions are in English. The Polish interface remains available.

## Marking and configuring Hordes

Select NPC tokens and click the group icon on the Token toolbar, or use `/horde toggle`. If all selected tokens are marked, the action unmarks them; otherwise, it marks all of them. Player characters are ignored.

Each NPC combatant has a **Horde** toggle in initiative. Click to request a confirmed membership change; right-click to open the full Horde menu. A token's HUD has one **Horde** button that opens all actions, including Split/Merge Horde. On the NPC sheet, the single **Horde** button opens all actions.

Use the same Horde identifier for members that should share progress. Eight separate goblins should each represent one creature; one token representing eight goblins should have a count of eight. Native attacks with different attack bonuses retain separate progress because they use different table thresholds.

The configuration shows current population, initial population, and the base HP of one creature. **Attacks per initiative turn** defaults to one; set it to two for a two-attack Multiattack.

## Initiative and attacks

During a started combat, the active NPC combatant is the attacker, even when the attack is clicked on another NPC's open sheet. When possible, the module finds the equivalent item/activity on the active NPC. Otherwise, it uses the clicked activity as a template.

Target one creature and use its normal weapon, spell attack, or attack ability. A marked Horde resolves immediately unless the per-attack dialog setting is enabled. If no single target is selected, a GM dialog opens.

All allowed attacks against the same target contribute to shared progress, including the second attack of a Multiattack. Attack numbers reserve the combatant's allowed attempts; they do not divide progress. Limits are stored per combatant and round across sheets, weapons, and targets. Extra clicks after the limit are rejected. New rounds renew allowed attempts without clearing progress.

Counters are separate for Horde identifier, target, attack bonus, and target AC. Counters are stored on the combat, or on the scene outside combat. `/horde reset` clears them without reversing damage or restoring resources.

The normal damage-only button on a marked Horde's attack is blocked. Damage is rolled through an attack or through **Force hit**, so repeatedly clicking damage cannot bypass hit counting. Save-activity damage rolls keep their native behavior.

### Mob Attacks table

Required d20 result = target AC − attack bonus.

| Required d20 | Creatures per hit |
|---|---:|
| 5 or less | 1 |
| 6–12 | 2 |
| 13–14 | 3 |
| 15–16 | 4 |
| 17–18 | 5 |
| 19 | 10 |
| 20 or more | 20 |

Eight orcs with +5 against AC 19 require a 14: three creatures per hit. They generate two hits and retain 2/3 progress for a later attack, including attacks in later rounds.

The table does not use advantage, disadvantage, or critical damage. For mixed attackers, each completed group uses the highest average damage profile contributed by that group. Profiles are frozen before later attacks. Average damage uses the midpoint of minimum and maximum roll totals; exotic nonlinear formulas may only be approximated.

Each hit uses the activity's normal damage configuration, including type and scaling. Attack damage is applied manually. Normal activity usage retains the system's spell-slot/resource consumption. Ammunition is consumed per represented attack. Individual members' separate spell-slot pools are not modeled.

### Force hit

Choose **Horde → Force hit** on the NPC sheet, or use the GM button after a missed attack. It rolls one hit and clears this Horde's progress against the chosen target, across bonuses and AC values. Other targets are unchanged.

Forcing before an attack consumes an available attempt. Forcing after the latest missed attempt converts that attempt without consuming ammunition twice. An already successful or forced attempt cannot be forced again. Buttons on old chat messages require the same active turn and a cached action; after a reload, use the sheet menu.

## Population HP and token size

Maximum HP = the original creature's maximum HP × the initial number of creatures. Repeated configuration does not multiply HP again. Living population is the number of member pools above zero HP. Damage drains the member with the lowest current HP first, then the next weakest. The initial population remains recorded. Zero HP means zero living members.

Losing a full creature's worth of HP removes one member. A partly wounded member still counts. Healing can restore members up to the original population. Changing the configured count establishes a new initial population while preserving existing damage. Disabling Horde restores the base HP and footprint.

A linked token is converted into an unlinked token before HP changes, so other copies of the world actor are unaffected. Changes apply to the token and its synthetic actor sheet, not the shared actor-directory entry.

### Configurable growth thresholds

In **Configure Settings → YarpenArt: Mob Attacker → Population size rules**, set the minimum living population for each transition:

- Base Small: Medium, Large, Huge, and Gargantuan.
- Base Medium: Large, Huge, and Gargantuan.
- Base Large: Huge and Gargantuan.

Each base size has independent values. Thresholds must strictly increase and be between 2 and 200. Existing Horde tokens are resized after valid settings changes. Their original base size is retained even when the Horde has already grown.

| Base size | Medium | Large | Huge | Gargantuan |
|---|---:|---:|---:|---:|
| Small | 2 | 3 | 6 | 10 |
| Medium | — | 3 | 6 | 10 |
| Large | — | — | 6 | 10 |

Medium/Small tokens occupy 1×1 grid spaces; Large 2×2, Huge 3×3, and Gargantuan 4×4. A Horde never becomes smaller than its original creature size. These are visual/token footprints; the module does not rewrite reach or weapon rules.

## Splitting a Horde

Open the specific token's HUD and choose **Horde → Split/Merge Horde**, or use the same menu on its sheet or by right-clicking its initiative Horde button. The Horde must have at least two living members. All living members become individual tokens, still marked as members of the same Horde.

The original token and combatant are retained as the first member. Generated individual names follow the naming settings described above. New tokens receive independent HP, the creature's original size, and copies of its items/effects. Nearby free positions are used; splitting stops before changing anything if there is insufficient space within the scene. Placement avoids occupied token footprints but does not evaluate walls or terrain.

By default, every member keeps the original Horde initiative. Set **Split Horde: initiative** to **Individual initiatives: restore saved or roll missing** to restore their recorded results for this combat, rolling only members without a recorded result. A new encounter starts a new initiative memory. Already spent attack slots for the current round are inherited, preventing free attacks by splitting after attacking. Target progress is retained. Equal-initiative ordering is handled by Foundry; the currently active combatant is preserved.

**Split Horde: HP distribution**, inside **HP, split and merge rules**, is a world setting:

- **As evenly as possible:** integer HP values differ by at most one.
- **Random, preserving total HP:** each member receives between 1 and its base maximum HP. The sum remains equal to the original Horde's current HP. A full-health Horde therefore splits into full-health members in either mode.

For example, 50 HP across eight goblins with 7 base HP gives `7, 7, 6, 6, 6, 6, 6, 6` in equal mode. Temporary HP remains on the original token and is not duplicated. Each token stores its split origin and the original Horde's initial population for reference.

## Horde saving throws

With a Horde token selected, click a spell's normal saving-throw button. The module reads its ability and DC. Alternatively, choose **Horde → Horde saving throw** on the NPC sheet or use `/horde save` to enter DC manually.

The bonus includes the system's ability modifier, proficiency, save bonuses, cover where applicable, and exhaustion adjustments; it can be edited. Required d20 = DC − save bonus. The same table determines successes: needing 6–12 gives one success per two creatures. Separate tokens in the same group share partial progress for the same spell usage. Manual saves share progress by group, ability, DC, and bonus in the current combat/scene.

Choose **Force number of successes** and enter 0–N to override the table; N makes every member succeed. This clears that save counter's remainder. Each token may resolve a given spell-card save once. Forced mode may replace a pending result before damage is applied.

### Spell damage after saves

For Fireball and similar spells, resolve the save from its usage card and roll native damage from that same card. The damage is linked to the GM save summary, whether rolled before or after the save. Alternatively, enter a damage amount or dice formula and a damage type manually.

Choose no, half, or full damage on a successful save. The effect covers all living members represented by that token. The system calculates damage per successful and failed creature, including resistances/immunities and rounding, then the module multiplies by the corresponding populations.

Click **Apply Horde save damage** in the GM summary to subtract the total from the shared HP pool and update population/size. Do not also apply normal system damage to that token for the same effect. Damage uses a pooled abstraction: overkill contributes to the pool rather than tracking separate wounds per creature. Temporary HP is one shared token pool.

A persistent lock prevents applying the same result twice. If HP changes after the save, resolve a replacement before applying damage. No fabricated d20 rolls or automatic spell status effects are created; external automation requiring individual d20 saves may need manual handling.

## Chat commands and macros

Select an NPC token; during combat, the active NPC is preferred for attacks.

```text
/horde
/horde config
/horde toggle
/horde save
/horde help
/horde reset
/horde 5 | 1d6+3 | 8 | 1 | Orcs
/r 1d20+5 #horde | 1d6+3
```

The attack command format is `/horde BONUS | DAMAGE | CREATURES | ATTACKS | NAME`. Without a damage formula, marked raw rolls use the configured formula. Ordinary `/r`, inline rolls, and arbitrary macros are not guessed to be attacks. Macros using `AttackActivity.rollAttack` are integrated.

The module API is available at `game.modules.get("yarpenart-mob-attacker").api`, including `configure`, `attack`, `save`, `split`, `splitMerge`, `mergeSelected`, `reset`, `help`, and `toggleSelected`.

## Visibility, compatibility, and validation

Horde rules, counters, and save summaries are whispered to GMs. Ordinary attack damage cards retain the chosen public/private/blind/self visibility. The active GM with the alphabetically first user ID resolves module actions to avoid competing writes.

Supported target: **Foundry v14 / dnd5e 5.3.3**, with libWrapper. Validation uses automated API fixtures; the interface has not been tested in a live Foundry session. Other systems and system versions are not declared compatible.

Run the tests with:

```sh
node --test tests/*.test.mjs
```

## Earlier releases

- **0.2.0:** shared Multiattack progress, population HP and size, group saves, native spell damage distribution, and one-time damage application.
- **0.1.3:** initiative-based attacker identity, turn limits, same-sheet attacks for different combatants, and Force hit.
- **0.1.2:** durable counter storage and progress carried between rounds.
- **0.1.1:** Foundry v14 chat command interception, roll-mode metadata fixes, bulk Horde toggling, and GM-only rule summaries.
