(() => {
  const HOST_ID = 'alzator-root';
  // Hlídač shopů injects its widget (div[data-hs]) right after the buy buttons; ours goes above it.
  const BUY_ACTIONS = '.price-detail__buy-actions';
  const HLIDAC = ':scope > [data-hs]';
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  const lang = chrome.i18n.getUILanguage();
  const fmt = (value, currency) =>
    new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: currency === 'EUR' ? 2 : 0 }).format(value);

  const STYLE = `
    :host { all: initial; display: block; font: 14px/1.4 system-ui, sans-serif; color: #1d2433; }
    .box { margin: 16px 0 20px; border: 1px solid #dfe3eb; border-radius: 12px; padding: 14px 16px; background: #fff; }
    h3 { margin: 0 0 10px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 500; color: #6b7385; font-size: 12px; padding: 0 6px 6px; }
    td { padding: 6px; border-top: 1px solid #eef0f4; white-space: nowrap; vertical-align: top; }
    td.num, th.num { text-align: right; }
    tr.current td { background: #f3f6ff; }
    tr.current td.shop { font-weight: 600; }
    td.best .czk { color: #0b8a3e; font-weight: 700; }
    .local { display: block; font-size: 11px; color: #8a91a1; }
    .tag { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px; font-size: 11px; background: #fff3cd; color: #7a5b00; }
    .up { color: #c62828; } .down { color: #0b8a3e; }
    .muted { color: #8a91a1; }
    a { color: #1a56db; text-decoration: none; } a:hover { text-decoration: underline; }
    .note { margin-top: 8px; font-size: 12px; color: #6b7385; }
  `;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children.filter((c) => c != null));
    return node;
  }

  // The price the user would actually pay on that shop.
  const bestFor = (shop) => shop.alzaPlus?.czk ?? shop.mine?.czk ?? null;

  function priceCell(price, currency, extraClass = '') {
    if (!price) return el('td', { class: 'num muted' }, '-');
    const czk = price.czk == null ? null : el('span', { class: 'czk' }, fmt(price.czk, 'CZK'));
    const local = currency === 'CZK' ? null : el('span', { class: czk ? 'local' : '' }, fmt(price.value, currency));
    return el('td', { class: `num ${extraClass}` }, czk, local);
  }

  function renderRows(shops, showPlus) {
    const here = shops.find((s) => s.host === location.host);
    const base = here ? bestFor(here) : null;
    const priced = shops.filter((s) => bestFor(s) != null);
    const cheapest = priced.length ? Math.min(...priced.map(bestFor)) : null;
    const sorted = [...priced].sort((a, b) => bestFor(a) - bestFor(b)).concat(shops.filter((s) => bestFor(s) == null));
    const columns = showPlus ? 4 : 3;

    return sorted.map((shop) => {
      const isHere = shop.host === location.host;
      const link = el('a', { href: shop.url, target: '_blank', rel: 'noopener' }, shop.host.replace('www.', ''));
      const variant = shop.variant ? el('span', { class: 'tag', title: shop.sku ?? '' }, t('variant')) : null;
      const stock = shop.found && !shop.inStock ? el('span', { class: 'local' }, t('outOfStock')) : null;
      const shopCell = el('td', { class: 'shop' }, link, variant, stock);
      if (!shop.found) {
        const reason = shop.error ? t('error') : t('unavailable');
        return el('tr', {}, shopCell, el('td', { class: 'num muted', colspan: String(columns) }, reason));
      }
      const best = bestFor(shop) === cheapest;
      let diff = '';
      if (base && !isHere) {
        const pct = ((bestFor(shop) - base) / base) * 100;
        diff = el('span', { class: pct > 0 ? 'up' : 'down' }, `${pct > 0 ? '+' : ''}${pct.toFixed(1)} %`);
      }
      return el(
        'tr',
        { class: isHere ? 'current' : '' },
        shopCell,
        priceCell(shop.anon, shop.currency),
        priceCell(shop.mine, shop.currency, best && !shop.alzaPlus ? 'best' : ''),
        showPlus ? priceCell(shop.alzaPlus, shop.currency, best && shop.alzaPlus ? 'best' : '') : null,
        el('td', { class: 'num' }, diff),
      );
    });
  }

  function render(root, data) {
    const box = root.querySelector('.box');
    box.replaceChildren(el('h3', {}, t('title')));
    if (!data || data.error || !data.shops) {
      box.append(el('div', { class: 'muted' }, t('error')));
      return;
    }
    const showPlus = data.shops.some((s) => s.alzaPlus);
    const head = el(
      'tr',
      {},
      el('th', {}, t('colShop')),
      el('th', { class: 'num' }, t('colAnon')),
      el('th', { class: 'num' }, t('colMine')),
      showPlus ? el('th', { class: 'num' }, t('colAlzaPlus')) : null,
      el('th', { class: 'num' }, t('colDiff')),
    );
    box.append(el('table', {}, el('thead', {}, head), el('tbody', {}, ...renderRows(data.shops, showPlus))));
    const rate = data.eurCzk
      ? t('rateNote', [data.rateDate ?? '', new Intl.NumberFormat(lang, { minimumFractionDigits: 3 }).format(data.eurCzk)])
      : t('rateMissing');
    box.append(el('div', { class: 'note' }, `${t('vatNote')} ${rate}`));
  }

  function findAnchor() {
    const buy = document.querySelector(BUY_ACTIONS);
    if (buy) return { node: buy, place: 'after' };
    const price = document.querySelector('.price-detail');
    return price ? { node: price, place: 'before' } : null;
  }

  function waitForAnchor(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const found = findAnchor();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const anchor = findAnchor();
        if (anchor) {
          obs.disconnect();
          resolve(anchor);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  // Keeps our box directly above Hlídač shopů, which may be injected before or after us.
  function keepAboveHlidac(host) {
    const parent = host.parentElement;
    if (!parent) return;
    const fix = () => {
      const hlidac = parent.querySelector(HLIDAC);
      if (hlidac && hlidac.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING) hlidac.before(host);
    };
    fix();
    new MutationObserver(fix).observe(parent, { childList: true });
  }

  let lastUrl = null;

  async function run() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    document.getElementById(HOST_ID)?.remove();
    if (!/-d\d+\.htm/i.test(location.pathname) && !new URLSearchParams(location.search).has('dq')) return;

    const anchor = await waitForAnchor();
    if (!anchor) return;
    const host = el('div', { id: HOST_ID });
    const root = host.attachShadow({ mode: 'open' });
    root.append(el('style', {}, STYLE), el('div', { class: 'box' }, el('h3', {}, t('title')), el('div', { class: 'muted' }, t('loading'))));
    if (anchor.place === 'after') {
      anchor.node.after(host);
      keepAboveHlidac(host);
    } else {
      anchor.node.before(host);
    }

    const data = await chrome.runtime.sendMessage({ type: 'alzator:compare', url: location.href }).catch(() => null);
    if (host.isConnected) render(root, data);
  }

  run();
  window.navigation?.addEventListener('navigatesuccess', run);
})();
