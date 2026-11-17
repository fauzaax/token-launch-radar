// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked, bridged or
// versioned product of one that trades. The snapshot's watchlist is the floor: every watchlist slug is
// on the board, and the rest of the board is every other protocol the same rule keeps, ranked by the
// same function. Protocols whose token already trades are kept apart, in the Live view, at the
// market's own values: a market cap is a fact, never a model's claim.
//
// Implied value follows only from the snapshot's own figures, in four factors:
//
//   multiple = median(mcap_usd / tvl_usd) over the snapshot's live-token protocols
//              (ratios trimmed to [0.01, 10], CEX excluded): the market's own price
//              for a unit of TVL, read off the protocols that already trade.
//   growth   = 1 + clamp(change_7d, -50, 150) / 100 * 0.6
//   age      = 0.70 + min(age_days, 730) / 730 * 0.30   (age unknown: 365 days)
//   reach    = 1 + 0.03 * min(max(chains - 1, 0), 4)    (multi-chain footprint, at most 1.12)
//   implied  = max(1, round(tvl_usd * multiple * growth * age * reach))
//
// No protocol name is ever special-cased: the same function scores every row, and the multiple is
// recomputed from whatever snapshot the program reads, so a future snapshot re-prices the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The multiple is derived per snapshot. */
export interface ModelConstants {
  market_multiple: number;
  multiple_protocols: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  unknown_age_days: number;
  reach_step: number;
  reach_max_steps: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    market_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs, in compact arrays: dictionaries plus one array per row. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  cats: string[];
  chains: string[];
  rows: Array<[number, string, string, number, number[], number, number | null, number | null, number, number]>;
  live: Array<[string, string, number, number[], number, number | null, number | null]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The median of a sorted array of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The market multiple: the median market-cap-to-TVL ratio of the snapshot's own live-token
 * protocols. Ratios outside [0.01, 10] are trimmed as outliers, and exchanges are excluded: an
 * exchange's TVL is custody, not a protocol's product. Falls back to 0.25 when the snapshot
 * carries no usable live-token protocol, so the board still ranks.
 */
export function marketMultiple(snapshot: Snapshot): { multiple: number; count: number } {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .filter((r) => r >= 0.01 && r <= 10)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return { multiple: 0.25, count: 0 };
  return { multiple: median(ratios), count: ratios.length };
}

/** The model's constants for one snapshot: the derived multiple plus the fixed weights. */
export function modelFor(snapshot: Snapshot): ModelConstants {
  const { multiple, count } = marketMultiple(snapshot);
  return {
    market_multiple: multiple,
    multiple_protocols: count,
    growth_weight: 0.6,
    growth_floor: -50,
    growth_cap: 150,
    age_floor: 0.7,
    age_range: 0.3,
    age_days: 730,
    unknown_age_days: 365,
    reach_step: 0.03,
    reach_max_steps: 4,
  };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; ageMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult = model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days) / model.age_days) * model.age_range;
  const reachMult = 1 + model.reach_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_steps);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.market_multiple * growthMult * ageMult * reachMult));
  return { implied, growthPct, growthMult, ageMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked, bridged or
 * versioned product under the same rule the watchlist was drawn with, as far as the snapshot's ten
 * fields can tell. The watchlist itself is always kept, whatever this says.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, growthPct, growthMult, ageMult, reachMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, ageMult, reachMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      market_multiple: model.market_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      reach_multiplier: round4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol spans more than one, for the repeat step. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** What gas costs on a chain, from the chain's own name: mainnet is dear, the rest are cheap. */
function gasFor(chain: string): { setup: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return { setup: 'about $9 of ETH for gas', weekly: 'about $6 of gas a week' };
  if (c.includes('solana')) return { setup: 'under $0.10 of SOL for fees', weekly: 'under $0.05 of fees a week' };
  if (c.includes('bitcoin')) return { setup: 'about $3 of BTC for network fees', weekly: 'about $2 of fees a week' };
  return { setup: "about $1.50 of the chain's native token for gas", weekly: 'about $1 of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('restak')) return `Restake $${capital} of liquid staking tokens through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('staking') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in the destination app.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the vault shares.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} of USDC into a ${name} curator vault on ${chain} and keep the shares.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and let the yield compound.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('stable') || c.includes('algo-stables')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and place one position on a ${name} market on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Commit $${capital} through ${name}'s launchpad on ${chain} and join the next allocation round.`;
  if (c.includes('payment') || c.includes('card')) return `Load $${capital} onto ${name} on ${chain} and make one real payment through it.`;
  if (c.includes('privacy')) return `Deposit $${capital} of USDC into ${name}'s shielded pool on ${chain} and keep the note.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('synthetic')) return `Mint $${capital} of synthetic assets through ${name} on ${chain} and keep the position collateralised.`;
  if (c.includes('governance')) return `Deposit $${capital} with ${name} on ${chain} and cast one governance vote from the same wallet.`;
  if (c.includes('locker')) return `Lock $${capital} of tokens through ${name} on ${chain} for the shortest lock it offers.`;
  if (c.includes('nft')) return `List or buy one item worth about $${capital} through ${name} on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use ${name}'s flagship app with the funds.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The follow-up action: a second, different touch so the wallet is not a one-transaction farmer. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string, second: string | null): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow 30% of the collateral's value in a stablecoin, hold the loan a week, then repay it in full.`;
  if (c.includes('dex')) return `Swap $${half} between the pool's two assets once, so the wallet shows trading volume beside the liquidity.`;
  if (c.includes('bridge')) return `Bridge half the funds back a week later so the wallet shows two-way volume through ${name}.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake a second, smaller amount of $${half} from the same wallet a week later.`;
  if (second !== null) return `Repeat the main action with $${half} on ${second}, the protocol's second chain, from the same wallet.`;
  return `Repeat the main action a week later with $${half} more, from the same wallet, so the activity spans two weeks.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 * The dashboard's page runs the same derivation, so the two never disagree.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, fund it on ${chain} before the first transaction, and keep its seed phrase offline.`,
      cost: gas.setup,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain, second),
      cost: gas.weekly,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so the wallet stays active across snapshots.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, check the protocol's own points or rewards page, claim only from the link it publishes, and log every transaction hash with its date.`,
      cost: 'nothing to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot, in compact arrays. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = modelFor(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const cats: string[] = [];
  const catIdx = new Map<string, number>();
  const chains: string[] = [];
  const chainIdx = new Map<string, number>();
  const ci = (c: string | null): number => {
    const key = c ?? '';
    let i = catIdx.get(key);
    if (i === undefined) {
      i = cats.length;
      cats.push(key);
      catIdx.set(key, i);
    }
    return i;
  };
  const chi = (c: string): number => {
    let i = chainIdx.get(c);
    if (i === undefined) {
      i = chains.length;
      chains.push(c);
      chainIdx.set(c, i);
    }
    return i;
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    cats,
    chains,
    rows: board.map((r) => [r.rank, r.slug, r.name, ci(r.category), r.chains.map(chi), r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, r.watchlist ? 1 : 0]),
    live: live.map((r) => [r.slug, r.name, ci(r.category), r.chains.map(chi), r.tvl_usd, r.mcap_usd, r.change_7d]),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && new Set(board.map((r) => r.implied_value_usd)).size === 1) return 'every row shares the same implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
