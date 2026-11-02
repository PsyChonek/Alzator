(() => {
  const HOST_ID = 'alzator-root';
  const ANCHORS = ['.price-detail', '.js-price-box', 'h1'];
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  const lang = chrome.i18n.getUILanguage();
  const fmt = (value, currency) =>
    new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

  const STYLE = `
    :host { all: initial; display: block; margin: 0 0 16px; font: 14px/1.4 system-ui, sans-serif; color: #1d2433; }
    .box { border: 1px solid #dfe3eb; border-radius: 12px; padding: 14px 16px; background: #fff; }
    h3 { margin: 0 0 10px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 500; color: #6b7385; font-size: 12px; padding: 0 6px 6px; }
    td { padding: 6px; border-top: 1px solid #eef0f4; white-space: nowrap; }
    td.num, th.num { text-align: right; }
    tr.current td { background: #f3f6ff; font-weight: 600; }
    tr.best td.czk { color: #0b8a3e; font-weight: 700; }
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

  function waitForAnchor(timeoutMs = 10000) {
    const find = () => ANCHORS.map((s) => document.querySelector(s)).find(Boolean);
    return new Promise((resolve) => {
      const found = find();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const node = find();
        if (node) {
          obs.disconnect();
          resolve(node);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function renderRows(shops) {
    const current = shops.find((s) => s.host === location.host);
    const baseCzk = current?.czk ?? null;
    const priced = shops.filter((s) => s.czk != null);
    const bestCzk = priced.length ? Math.min(...priced.map((s) => s.czk)) : null;
    const sorted = [...priced].sort((a, b) => a.czk - b.czk).concat(shops.filter((s) => s.czk == null));

    return sorted.map((shop) => {
      const classes = [shop.host === location.host && 'current', shop.czk === bestCzk && 'best'].filter(Boolean);
      const link = el('a', { href: shop.url, target: '_blank', rel: 'noopener' }, shop.host.replace('www.', ''));
      if (!shop.offer) {
        const reason = shop.error ? t('error') : t('unavailable');
        return el('tr', {}, el('td', {}, link), el('td', { class: 'num muted', colspan: '3' }, reason));
      }
      let diff = null;
      if (baseCzk && shop.host !== location.host) {
        const pct = ((shop.czk - baseCzk) / baseCzk) * 100;
        const sign = pct > 0 ? '+' : '';
        diff = el('span', { class: pct > 0 ? 'up' : 'down' }, `${sign}${pct.toFixed(1)} %`);
      }
      const local = shop.offer.currency === 'CZK' ? '' : fmt(shop.offer.price, shop.offer.currency);
      const stock = shop.offer.inStock ? null : el('span', { class: 'muted' }, ` (${t('outOfStock')})`);
      return el(
        'tr',
        { class: classes.join(' ') },
        el('td', {}, link, stock),
        el('td', { class: 'num muted' }, local),
        el('td', { class: 'num czk' }, fmt(shop.czk, 'CZK')),
        el('td', { class: 'num' }, diff ?? ''),
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
    const head = el(
      'tr',
      {},
      el('th', {}, t('colShop')),
      el('th', { class: 'num' }, t('colLocal')),
      el('th', { class: 'num' }, t('colCzk')),
      el('th', { class: 'num' }, t('colDiff')),
    );
    box.append(el('table', {}, el('thead', {}, head), el('tbody', {}, ...renderRows(data.shops))));
    const rate = data.eurCzk
      ? t('rateNote', [data.rateDate ?? '', new Intl.NumberFormat(lang, { minimumFractionDigits: 3 }).format(data.eurCzk)])
      : t('rateMissing');
    box.append(el('div', { class: 'note' }, `${t('vatNote')} ${rate}`));
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
    anchor.before(host);

    const data = await chrome.runtime.sendMessage({ type: 'alzator:compare', url: location.href }).catch(() => null);
    if (host.isConnected) render(root, data);
  }

  run();
  window.navigation?.addEventListener('navigatesuccess', run);
})();
