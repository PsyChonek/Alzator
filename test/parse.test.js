import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOPS,
  extractProductId,
  productUrl,
  codeUrl,
  baseCode,
  variantCodes,
  parseOffer,
  parseLocalNumber,
  parseProductPage,
  parseCnbRates,
  toCzk,
  safeShopUrl,
} from '../src/parse.js';

test('extractProductId reads the -d<id>.htm suffix', () => {
  assert.equal(extractProductId('https://www.alza.cz/gigabyte-geforce-rtx-5070-ti-gaming-oc-16g-d12814009.htm'), '12814009');
  assert.equal(extractProductId('https://www.alza.sk/EN/foo-d12814009.htm?o=1'), '12814009');
  assert.equal(extractProductId('https://www.alza.cz/kosik.htm?dq=555'), '555');
  assert.equal(extractProductId('https://www.alza.cz/graficke-karty/18842862.htm'), null);
});

test('productUrl builds a slug-less URL that Alza redirects', () => {
  assert.equal(productUrl('www.alza.de', '12814009'), 'https://www.alza.de/-d12814009.htm');
});

test('parseOffer reads price, currency and stock from JSON-LD', () => {
  const html = `<html><script type="application/ld+json">{"@type":"Organization"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"GIGABYTE RTX 5070 Ti",
    "offers":{"@type":"Offer","url":"https://www.alza.de/x-d12814009.htm","availability":"https://schema.org/InStock",
    "price":1399,"priceCurrency":"EUR"}}</script></html>`;
  assert.deepEqual(parseOffer(html), {
    name: 'GIGABYTE RTX 5070 Ti',
    sku: null,
    price: 1399,
    currency: 'EUR',
    inStock: true,
    url: 'https://www.alza.de/x-d12814009.htm',
  });
});

test('parseOffer returns null without a product offer', () => {
  assert.equal(parseOffer('<script type="application/ld+json">{broken</script>'), null);
  assert.equal(parseOffer('<html></html>'), null);
});

const ldJson = (price, currency, sku) =>
  `<script type="application/ld+json">{"@type":"Product","sku":"${sku}","offers":{"price":${price},"priceCurrency":"${currency}","availability":"https://schema.org/InStock"}}</script>`;

test('parseLocalNumber handles Alza price formats', () => {
  assert.equal(parseLocalNumber('Bez členství: 39 490,-'), 39490);
  assert.equal(parseLocalNumber('1.134,98 €'), 1134.98);
  assert.equal(parseLocalNumber('1.399 €'), 1399);
  assert.equal(parseLocalNumber('Bez členstva: 1 789,00 €'), 1789);
  assert.equal(parseLocalNumber('537 290 Ft'), 537290);
  assert.equal(parseLocalNumber('měsíčně'), null);
});

test('parseProductPage splits AlzaPlus+ and non-member price', () => {
  const html = `${ldJson(35541, 'CZK', 'SAMO0285c1')}
    <div class="ads-pb js-price-box ads-pb--alza-plus ads-pb--basic" data-slot="pb-wrapper">
    <span class="ads-pb__price-value js-price-box__primary-price__value">35 541,-</span>
    <span class="ads-pb__original-price">Bez členství: 39 490,-</span></div>`;
  const page = parseProductPage(html);
  assert.equal(page.price, 39490);
  assert.equal(page.alzaPlus, 35541);
  assert.equal(page.sku, 'SAMO0285c1');
});

test('parseProductPage ignores original-price outside an AlzaPlus+ box', () => {
  const html = `${ldJson(42211, 'CZK', 'X')}
    <div class="ads-pb js-price-box ads-pb--basic"><span class="ads-pb__original-price">Ušetříte 479,-</span></div>`;
  const page = parseProductPage(html);
  assert.equal(page.price, 42211);
  assert.equal(page.alzaPlus, null);
});

test('regional variant codes', () => {
  const [cz, , de, at, hu] = SHOPS;
  assert.equal(baseCode('SAMO0285c1DE', de), 'SAMO0285c1');
  assert.equal(baseCode('SAMO0285c1DE', at), 'SAMO0285c1');
  assert.equal(baseCode('SAMO0285c1', cz), 'SAMO0285c1');
  assert.equal(baseCode('DE', de), 'DE');
  assert.deepEqual(variantCodes('SAMO0285c1', hu), ['SAMO0285c1HU', 'SAMO0285c1']);
  assert.equal(codeUrl('www.alza.de', 'SAMO0285c1DE'), 'https://www.alza.de/kod/SAMO0285c1DE');
});

test('parseOffer rejects a malformed currency', () => {
  const html = `<script type="application/ld+json">{"@type":"Product","offers":{"price":1,"priceCurrency":"xx"}}</script>`;
  assert.equal(parseOffer(html), null);
});

test('safeShopUrl keeps only https links on the fetched shop', () => {
  const fallback = 'https://www.alza.de/-d1.htm';
  assert.equal(safeShopUrl('https://www.alza.de/a-d1.htm', 'www.alza.de', fallback), 'https://www.alza.de/a-d1.htm');
  assert.equal(safeShopUrl('javascript:alert(1)', 'www.alza.de', fallback), fallback);
  assert.equal(safeShopUrl('https://evil.example/', 'www.alza.de', fallback), fallback);
  assert.equal(safeShopUrl(undefined, 'www.alza.de', fallback), fallback);
});

test('parseCnbRates converts per-amount rates to CZK per unit', () => {
  const text = '30.10.2026 #209\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,360\nMaďarsko|forint|100|HUF|6,649\n';
  const { date, rates } = parseCnbRates(text);
  assert.equal(date, '30.10.2026');
  assert.equal(rates.EUR, 24.36);
  assert.ok(Math.abs(rates.HUF - 0.06649) < 1e-9);
  assert.equal(toCzk(1399, 'EUR', rates), 1399 * 24.36);
  assert.equal(toCzk(100, 'USD', rates), null);
});
