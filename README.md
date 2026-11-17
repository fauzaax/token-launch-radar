# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fauzaax/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fauzaax/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token, ranks them by an implied launch value derived from the snapshot's own figures, and hands in a dashboard with a concrete farm plan for every row.

## The model

Implied value is computed by one function, `impliedValue` in `lib/model.ts`, from the snapshot alone — no protocol name is ever special-cased:

- **Market multiple**: the median market-cap-to-TVL ratio of the snapshot's own live-token protocols (ratios trimmed to 0.01–10, CEX excluded). The market prices its own launches; the radar borrows that price.
- **Growth**: the 7-day TVL change, clamped to −50%…+150%, weighted at 0.6.
- **Age**: how long the protocol has run since DefiLlama first listed it, scaled over 730 days from a 0.70 floor (unknown age counts as 365 days).
- **Reach**: a small multiplier for the number of chains the protocol's TVL spans, capped at 1.12.

The board ranks every rankable pre-token protocol — all 40 watchlist protocols plus every other pre-token protocol below or above the floor that is not a wrapped, staked, bridged or versioned product — by that implied value. Protocols whose token already trades are set aside in a separate Live view with their real market caps, never mixed into the ranking.

Farm plans are generated from each protocol's own record (category, chains, TVL, age): every step states what it costs and how long it takes. The dashboard regenerates the same plan from the same figures, so the page and `board.json` always agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

`main.ts` (Node 22, standard library only, no network) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. It is deterministic: two runs write byte-identical output.

Open `out/dashboard/index.html` in a browser (it loads `../data.js`, no network) to use the radar: sort the board, filter by category or chain, and open any row for its model breakdown and farm plan.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xrzvk6jq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
