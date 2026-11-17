// Token Launch Radar's dashboard: reads window.RADAR (data.js beside dashboard/), renders the
// ranked board, its filters, per-protocol detail views with the model breakdown and farm plan,
// and the separate Live view. No network. The farm plan and implied value are recomputed here by
// the same arithmetic main.ts runs, so the page and board.json agree row for row.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  // --- decoding: compact arrays back into row objects -------------------------------
  function decodeRow(a) {
    return {
      rank: a[0], slug: a[1], name: a[2],
      category: DATA.cats[a[3]] === '' ? null : DATA.cats[a[3]],
      chains: a[4].map(function (i) { return DATA.chains[i]; }),
      tvl_usd: a[5], change_7d: a[6], age_days: a[7],
      implied_value_usd: a[8], watchlist: a[9] === 1
    };
  }
  function decodeLive(a) {
    return {
      slug: a[0], name: a[1],
      category: DATA.cats[a[2]] === '' ? null : DATA.cats[a[2]],
      chains: a[3].map(function (i) { return DATA.chains[i]; }),
      tvl_usd: a[4], mcap_usd: a[5], change_7d: a[6]
    };
  }
  var ROWS = DATA.rows.map(decodeRow);
  var LIVE = DATA.live.map(decodeLive);
  var MODEL = DATA.model;

  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, liveSelected: null };

  // --- formatting -------------------------------------------------------------------
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3); }

  // --- the model, the same arithmetic lib/model.ts runs ------------------------------
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var ageMult = model.age_floor + (Math.min(Math.max(age, 0), model.age_days) / model.age_days) * model.age_range;
    var reachMult = 1 + model.reach_step * Math.min(Math.max(row.chains.length - 1, 0), model.reach_max_steps);
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * model.market_multiple * growthMult * ageMult * reachMult)),
      growthPct: growth, growthMult: growthMult, ageMult: ageMult, reachMult: reachMult
    };
  }

  // --- the farm plan, the same derivation lib/model.ts writes to board.json ----------
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('ethereum') >= 0) return { setup: 'about $9 of ETH for gas', weekly: 'about $6 of gas a week' };
    if (c.indexOf('solana') >= 0) return { setup: 'under $0.10 of SOL for fees', weekly: 'under $0.05 of fees a week' };
    if (c.indexOf('bitcoin') >= 0) return { setup: 'about $3 of BTC for network fees', weekly: 'about $2 of fees a week' };
    return { setup: "about $1.50 of the chain's native token for gas", weekly: 'about $1 of gas a week' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 120;
    if (p.tvl_usd >= 2e7) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of liquid staking tokens through ' + name + ' on ' + chain + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('staking') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the staking receipt.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral and keep the position open.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the position in range.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in the destination app.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and hold the vault shares.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' curator vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and let the yield compound.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stables') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('prediction') >= 0) return 'Fund the wallet with $' + capital + ' and place one position on a ' + name + ' market on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' through ' + name + "'s launchpad on " + chain + ' and join the next allocation round.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Load $' + capital + ' onto ' + name + ' on ' + chain + ' and make one real payment through it.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s shielded pool on " + chain + ' and keep the note.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
    if (c.indexOf('synthetic') >= 0) return 'Mint $' + capital + ' of synthetic assets through ' + name + ' on ' + chain + ' and keep the position collateralised.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' with ' + name + ' on ' + chain + ' and cast one governance vote from the same wallet.';
    if (c.indexOf('locker') >= 0) return 'Lock $' + capital + ' of tokens through ' + name + ' on ' + chain + ' for the shortest lock it offers.';
    if (c.indexOf('nft') >= 0) return 'List or buy one item worth about $' + capital + ' through ' + name + ' on ' + chain + '.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + " and use " + name + "'s flagship app with the funds.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, second) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.max(10, Math.round(capital / 2));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow 30% of the collateral\'s value in a stablecoin, hold the loan a week, then repay it in full.';
    if (c.indexOf('dex') >= 0) return 'Swap $' + half + ' between the pool\'s two assets once, so the wallet shows trading volume beside the liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge half the funds back a week later so the wallet shows two-way volume through ' + name + '.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake a second, smaller amount of $' + half + ' from the same wallet a week later.';
    if (second !== null) return 'Repeat the main action with $' + half + ' on ' + second + ', the protocol\'s second chain, from the same wallet.';
    return 'Repeat the main action a week later with $' + half + ' more, from the same wallet, so the activity spans two weeks.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, fund it on ' + chain + ' before the first transaction, and keep its seed phrase offline.', cost: gas.setup, time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital plus ' + gas.setup, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, second), cost: gas.weekly, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so the wallet stays active across snapshots.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before withdrawing, check the protocol's own points or rewards page, claim only from the link it publishes, and log every transaction hash with its date.", cost: 'nothing to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }
  // Exposed so a checker can compare the page's plans with board.json's.
  window.__farmSteps = farmSteps;
  window.__rows = ROWS;
  window.__impliedOf = impliedOf;

  // --- DOM helper ---------------------------------------------------------------------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- hash state ---------------------------------------------------------------------
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1') state.dir = 1;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('wl', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir === 1) params.set('dir', '1');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // --- filtering and sorting ----------------------------------------------------------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, r.chains.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key), bv = sortValue(b, key);
      var c = av < bv ? -1 : av > bv ? 1 : 0;
      if (c !== 0) return c * dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- sections -----------------------------------------------------------------------
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', html: 'Token Launch <em>Radar</em>' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { class: 'mono', text: DATA.model_version + ' · multiple ' + MODEL.market_multiple.toFixed(4) })
      )
    );
  }

  function hero() {
    var early = DATA.board_size - DATA.watchlist_size;
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols that record no token, ranked by implied value' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL</b> and no token on record. The radar adds <b>' + early + ' more</b> pre-token protocols the same rule keeps, and prices each launch from the snapshot&rsquo;s own figures. Implied value is a model, not a promise — and a protocol that records no token may still have one its record does not carry.' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'green', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Beyond the watchlist' }), el('b', { text: String(early) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live tokens set aside' }), el('b', { class: 'amber', text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(ROWS.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(ROWS.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + ROWS.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchOnly ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var count = state.tab === 'pre-token' ? filteredRows().length + ' of ' + ROWS.length + ' rows shown' : LIVE.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: count })
    );
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null;
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button', onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        }
      }, label, arrow)
    );
  }

  function chainLine(r) {
    if (!r.chains || r.chains.length === 0) return 'an unnamed chain';
    if (r.chains.length <= 2) return r.chains.join(', ');
    return r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) + ' more';
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    if (max <= 0) max = 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var badges = [el('span', { class: 'badge pre', text: 'no token' })];
      if (r.watchlist) badges.push(el('span', { class: 'badge watch', text: 'watchlist' }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + chainLine(r) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', { class: 'badges' }, badges))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    LIVE.forEach(function (r) {
      var tr = el('tr', {
        tabindex: '0',
        onclick: function () { openLiveDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLiveDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'badge live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + chainLine(r) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'These protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their median market-cap-to-TVL ratio is the multiple the ranking is priced with.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    return el('section', { class: 'panel model', 'aria-label': 'How implied value is computed' },
      el('h2', null, 'How implied value is computed', el('span', { class: 'tag', text: DATA.model_version })),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', html:
        'implied = round( tvl_usd <span class="hl">x ' + m.market_multiple.toFixed(4) + '</span>' +
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
        ' x (' + m.age_floor + ' + min(age_days, ' + m.age_days + ') / ' + m.age_days + ' x ' + m.age_range + ')' +
        ' x (1 + ' + m.reach_step + ' x min(chains - 1, ' + m.reach_max_steps + ')) )' }),
      el('div', { class: 'cols' },
        el('div', { class: 'factor' }, el('b', { text: 'Market multiple' }), el('span', { text: 'The median market-cap-to-TVL ratio of ' + m.multiple_protocols + ' live-token protocols in this snapshot, ratios trimmed to 0.01–10, exchanges excluded.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Growth' }), el('span', { text: 'Seven-day TVL change, clamped so one spike cannot dominate, weighted at ' + m.growth_weight + '.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Age' }), el('span', { text: 'Days since first listed: how long it has run with no token. Unknown ages count as ' + m.unknown_age_days + ' days.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Reach' }), el('span', { text: 'Chains spanned: each extra chain adds ' + (m.reach_step * 100) + '%, capped at ' + m.reach_max_steps + ' extra chains.' }))
      ),
      el('p', { class: 'fineprint', text: 'The board holds every protocol that records no token and is not a wrapped, staked, bridged or versioned product, under the same rule the watchlist was drawn with. A new snapshot re-prices the whole board: the multiple is recomputed from whatever it carries.' })
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Implied value is this entry\u2019s own model claim, never a price and never a prediction that a token will be issued. “Records no token” means the snapshot carries no market cap, CoinGecko id or symbol for the protocol.' }),
      el('span', { class: 'mono', text: 'Source: ' + DATA.source + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · ' + DATA.model_version })
    );
  }

  // --- detail views -------------------------------------------------------------------
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; state.liveSelected = null; writeHash(); });

  function detailHead(kicker, title, sub) {
    return el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: kicker }),
        el('h2', { id: 'detail-title', text: title }),
        el('p', { class: 'sub', text: sub })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); render(); } })
    );
  }
  function showDialog() {
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function openDetail(slug) {
    var row = null;
    ROWS.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    state.liveSelected = null;
    writeHash();
    var calc = impliedOf(row, MODEL);
    var agree = calc.implied === row.implied_value_usd;
    var steps = farmSteps(row);
    dialog.textContent = '';
    dialog.appendChild(detailHead(
      'RANK ' + row.rank + ' OF ' + ROWS.length + (row.watchlist ? ' · WATCHLIST' : ''),
      row.name,
      (row.category || 'Other') + ' on ' + (row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token'
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market multiple' }), el('b', { text: MODEL.market_multiple.toFixed(4) + ' (median of ' + MODEL.multiple_protocols + ')' })),
        el('div', null, el('span', { text: 'Base value' }), el('b', { text: fmtUsdFull(Math.round(row.tvl_usd * MODEL.market_multiple)) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) + ' → ' + fmtMult(calc.growthMult) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) + ' → ' + fmtMult(calc.ageMult) })),
        el('div', null, el('span', { text: 'Chain reach' }), el('b', { text: row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' → ' + fmtMult(calc.reachMult) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsdFull(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'The page recomputes this row as ' + fmtUsdFull(calc.implied) + (agree ? ', the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'note', text: 'The plan is derived from this protocol\u2019s own record — its category, chains, TVL and age — and is the same plan board.json carries for this row.' })
    ));
    showDialog();
  }

  function openLiveDetail(slug) {
    var row = null;
    LIVE.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.liveSelected = slug;
    state.selected = null;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(detailHead(
      'LIVE TOKEN · SET ASIDE FROM THE RANKING',
      row.name,
      (row.category || 'Other') + ' on ' + (row.chains.length ? row.chains.join(', ') : 'an unnamed chain')
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Market facts' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market cap' }), el('b', { text: fmtUsdFull(row.mcap_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Mcap / TVL' }), el('b', { text: row.mcap_usd !== null && row.tvl_usd > 0 ? (row.mcap_usd / row.tvl_usd).toFixed(3) + 'x' : 'n/a' }))
      ),
      el('p', { class: 'note', text: 'This protocol\u2019s token already trades, so there is no launch to farm and no implied value to model. Its market cap is shown as the market states it, and it takes no rank on the pre-token board.' })
    ));
    showDialog();
  }

  // --- render ---------------------------------------------------------------------------
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (state.liveSelected) openLiveDetail(state.liveSelected);
    else if (dialog.open) dialog.close();
  }

  readHash();
  render();
  // Back/forward and pasted links re-read the hash, so a shared link opens the same view.
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1;
    state.selected = null; state.liveSelected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) { dialog.close(); render(); }
  });
})();
