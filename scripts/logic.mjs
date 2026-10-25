/** Mob Attacks (2014). Pure functions: no Foundry globals. */
export const TABLE = Object.freeze([[5, 1], [12, 2], [14, 3], [16, 4], [18, 5], [19, 10], [20, 20]]);
export function integer(value, min, max, label = 'value') {
  const n = Number(value);
  if (String(value).trim() === '' || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}: ${min}–${max}`);
  return n;
}
export function attackersNeeded(ac, bonus) {
  if (!Number.isFinite(ac) || !Number.isFinite(bonus)) throw new Error('Invalid AC / bonus');
  const needed = ac - bonus;
  // Natural 20 still hits; no critical damage under the mob rule.
  return TABLE.find(([upper]) => needed <= upper)?.[1] ?? 20;
}
export function resolveMob(ac, bonus, count, previous = 0) {
  integer(count, 1, 200, 'count');
  integer(previous, 0, Number.MAX_SAFE_INTEGER, 'previous');
  const threshold = attackersNeeded(ac, bonus);
  return {
    required: ac - bonus, threshold, before: previous,
    hits: Math.floor((previous + count) / threshold) - Math.floor(previous / threshold),
    after: previous + count, remainder: (previous + count) % threshold
  };
}
export function bucketKey({group, target, bonus, lane, ac}) {
  // AC participates so a Shield or other AC change never reuses old progress.
  return JSON.stringify([group, target, bonus, lane, ac]);
}
export function nextLane(state, group, source) {
  return 1 + Math.max(0, ...Object.values(state.buckets ?? {}).filter(b => b.group === group)
    .flatMap(b => b.sources?.includes(source) ? [b.lane] : []));
}
export function planAttack(state, {group, target, source, bonus, ac, count, lane}) {
  const key = bucketKey({group, target, bonus, lane, ac});
  const bucket = state.buckets?.[key];
  if (bucket?.sources?.includes(source)) throw new Error('DUPLICATE');
  const result = resolveMob(ac, bonus, count, bucket?.total ?? 0);
  return { key, result, bucket: {group, target, bonus, ac, lane, total: result.after,
    sources: [...(bucket?.sources ?? []), source]} };
}
/** Choose the highest-damage creature within each threshold-sized group. */
export function damageAssignments(previous, current, before, count, threshold) {
  const remainder = before % threshold;
  const strongest = previous && previous.average > current.average ? previous : current;
  const hits = Math.floor((remainder + count) / threshold);
  const profiles = Array.from({length:hits},(_,i) => i === 0 && remainder ? strongest : current);
  const next = (remainder + count) % threshold === 0 ? null : hits ? current : strongest;
  return {profiles, next};
}
/** Only the explicit command is inferred to be an attack. Plain /r is never guessed. */
export function parseCommand(text) {
  if (!/^\/horde(?:\s|$)/i.test(text.trim())) return null;
  const body = text.trim().replace(/^\/horde\s*/i, '');
  if (!body) return {action: 'open'};
  if (/^(config|reset|help|toggle)$/i.test(body)) return {action: body.toLowerCase()};
  const parts = body.split('|').map(x => x.trim());
  if (parts.length < 2 || parts.length > 5 || !parts[0] || !parts[1]) throw new Error('COMMAND');
  return {action: 'attack', bonus: parts[0], damage: parts[1],
    count: parts[2] ? integer(parts[2], 1, 200, 'count') : undefined,
    attacks: parts[3] ? integer(parts[3], 1, 10, 'attacks') : 1, name: parts[4] || 'Horde'};
}
/** Opt-in raw attack roll: /r 1d20+5 #horde | 1d6+3. */
export function parseMarkedRoll(text) {
  const match = text.trim().match(/^\/(r|roll|gmroll|gr|blindroll|broll|br|selfroll|sr)\s+1d20\s*([^#]*?)\s+#horde(?:\s*\|\s*(.+))?$/i);
  if (!match) return null;
  const bonus = match[2].trim() || '0';
  if (bonus !== '0' && !/^[+-]/.test(bonus)) throw new Error('COMMAND');
  return {action:'attack', bonus, damage:match[3]?.trim(), visibility:match[1].toLowerCase()};
}
/** Serialize all writes and damage rolls on the authoritative GM client. */
export function serialQueue() {
  let tail = Promise.resolve();
  return fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
}
