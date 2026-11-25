import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright-core';
import { filmTime } from '../src/lib/timeline.ts';

const engine = process.env.CABRALES_ENGINE ?? 'chromium';
const base = process.env.CABRALES_TEST_URL ?? 'https://localhost:4321/';
const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
}));
const capture = process.env.CABRALES_SCREENSHOTS === '1';
const errors = [];

async function pageFor(options = {}) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, ...options });
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}

async function open(page, path = '/') {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  assert.match(response.headers()['x-robots-tag'] ?? '', /noindex/);
  assert.equal(await page.locator('h1').count(), 1);
  return response;
}

async function scene(page, progress, chapter) {
  const expected = filmTime(progress, 541 / 24);
  await page.evaluate((p) => {
    const journey = document.querySelector('cabrales-journey');
    const start = scrollY + journey.getBoundingClientRect().top;
    const travel = journey.offsetHeight - journey.querySelector('.journey__stage').offsetHeight;
    window.scrollTo(0, Math.round(start + travel * p));
  }, progress);
  await page.waitForFunction(({ expected, chapter }) => {
    const journey = document.querySelector('cabrales-journey');
    const video = journey.querySelector('video');
    return journey.hasAttribute('data-frame-ready') && journey.dataset.chapter === chapter &&
      !video.seeking && Math.abs(video.currentTime - expected) < .13;
  }, { expected, chapter });
  assert.equal(await page.locator('.scene[data-active]').count(), 1);
  assert.equal(await page.locator('.scene[inert]').count(), 4);
  assert.equal(await page.locator('video').evaluate((v) => v.paused), true);
  return page.locator('video').evaluate((v) => v.currentTime);
}

function videoRequests(page) {
  const paths = new Set();
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.includes('/media/cabrales-scroll-')) paths.add(pathname);
  });
  return paths;
}

async function checkSource(page, paths, variant) {
  const expected = `/media/cabrales-scroll-${variant}.mp4`;
  assert.equal(await page.locator('video').evaluate((video) => new URL(video.currentSrc).pathname), expected);
  // WebKit on Windows fetches the video through its native media pipeline, outside Playwright's network events.
  if (engine === 'chromium' || paths.size) assert.deepEqual([...paths], [expected]);
}

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

async function screenshot(page, id) {
  if (!capture) return;
  await mkdir('reports/screenshots', { recursive: true });
  await page.screenshot({ path: `reports/screenshots/${engine}-${id}.png`, animations: 'disabled' });
}

try {
  const desk = await pageFor({ viewport: { width: 1440, height: 900 } });
  const deskVideo = videoRequests(desk);
  const response = await open(desk);
  assert.equal(response.headers()['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(await desk.locator('storyblok-preview').count(), 0);
  assert.equal(await desk.locator('[data-blok-uid]').count(), 0);
  await scene(desk, 0, 'cafe');
  await screenshot(desk, 'desktop-inicio');
  const grind = await scene(desk, .31, 'molido');
  const bag = await scene(desk, .575, 'super');
  await screenshot(desk, 'desktop-super');
  const family = await scene(desk, .765, 'origenes');
  assert.equal(await desk.locator('.product-card').count(), 4);
  const final = await scene(desk, .929, 'reunion');
  assert.ok(grind < bag && bag < family && family < final);
  await screenshot(desk, 'desktop-reunion');
  assert.ok(Math.abs(final - await scene(desk, .989, 'reunion')) < .04, 'el último cuadro queda congelado');
  assert.deepEqual(await desk.locator('.journey__stage').evaluate((el) => getComputedStyle(el).getPropertyValue('--film-blur')), '16.00px');
  assert.ok(await scene(desk, .29, 'molido') < grind, 'retroceder actualiza el fotograma');
  await scene(desk, 0, 'cafe');
  await desk.locator('.scene--cafe a[href="#productos"]').click();
  await desk.waitForFunction(() => document.querySelector('cabrales-journey').dataset.chapter === 'origenes');
  assert.equal(new URL(desk.url()).hash, '#productos');
  await screenshot(desk, 'desktop-origenes');
  await desk.getByRole('button', { name: 'Ver sin animación' }).click();
  await desk.waitForFunction(() => document.querySelector('cabrales-journey').dataset.mode === 'static');
  assert.equal(await desk.locator('.scene[inert]').count(), 0);
  assert.equal(await desk.locator('video').getAttribute('src'), null);
  assert.ok(Math.abs(await desk.locator('#productos').evaluate((el) => el.getBoundingClientRect().top)) < 4);
  await desk.keyboard.press('End');
  await desk.locator('.site-footer__up').click();
  assert.equal(new URL(desk.url()).hash, '#inicio');
  await desk.getByRole('button', { name: 'Ver con animación' }).click();
  await scene(desk, 0, 'cafe');
  await noOverflow(desk);
  await checkSource(desk, deskVideo, 'desktop');
  await desk.close();

  const mobile = await pageFor({
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const mobVideo = videoRequests(mobile);
  await open(mobile, '/cabrales-home-v2');
  await scene(mobile, 0, 'cafe');
  assert.equal(await mobile.locator('#inicio picture img').evaluate((i) => new URL(i.currentSrc).pathname), '/media/cafe-mobile.webp');
  await screenshot(mobile, 'movil-inicio');
  await mobile.locator('.site-menu summary').tap();
  await mobile.locator('.site-menu__nav a[href="#productos"]').tap();
  assert.equal(await mobile.locator('.site-menu').getAttribute('open'), null);
  assert.equal(await mobile.locator('cabrales-journey').getAttribute('data-chapter'), 'origenes');
  await scene(mobile, .765, 'origenes');
  await noOverflow(mobile);
  for (const card of await mobile.locator('.product-card').all()) {
    const { x, y, width, height } = await card.boundingBox();
    assert.ok(x > 0 && x + width < 391 && y > 0 && y + height < 844);
  }
  await screenshot(mobile, 'movil-origenes');
  await scene(mobile, .951, 'reunion');
  assert.ok(await scene(mobile, .52, 'super') < 17);
  await checkSource(mobile, mobVideo, 'mobile');
  await mobile.close();

  for (const [name, options, saveData] of [
    ['movimiento reducido', { reducedMotion: 'reduce' }, false],
    ['sin JavaScript', { javaScriptEnabled: false }, false],
    ['ahorro de datos', {}, true],
  ]) {
    const fallback = await pageFor({ viewport: { width: 1280, height: 800 }, ...options });
    const paths = videoRequests(fallback);
    if (saveData) {
      await fallback.addInitScript(() => Object.defineProperty(navigator, 'connection', {
        value: Object.assign(new EventTarget(), { saveData: true }),
      }));
    }
    await open(fallback, '/#productos');
    await fallback.locator('#productos h2').scrollIntoViewIfNeeded();
    assert.equal(await fallback.locator('.scene[inert]').count(), 0, name);
    assert.equal(await fallback.locator('video').getAttribute('src'), null, name);
    assert.deepEqual([...paths], [], name);
    await fallback.close();
  }

  const failed = await pageFor({ viewport: { width: 1366, height: 768 } });
  await failed.route(new URL('/', base).href, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      'data-desktop="/media/cabrales-scroll-desktop.mp4"',
      'data-desktop="/media/cabrales-sin-archivo.mp4"',
    );
    await route.fulfill({ response, body: html });
  });
  await open(failed);
  await failed.waitForFunction(() => document.querySelector('cabrales-journey').dataset.mode === 'static');
  assert.equal(await failed.locator('.scene[inert]').count(), 0);
  assert.equal(await failed.locator('video').getAttribute('src'), null);
  await failed.close();

  const deep = await pageFor();
  await open(deep, '/#reunion');
  await deep.waitForFunction(() => document.querySelector('cabrales-journey').dataset.chapter === 'reunion');
  const missing = await deep.goto(new URL('/no-existe', base).href);
  assert.equal(missing.status(), 404);
  assert.equal(await deep.getByRole('link', { name: 'Ir al inicio' }).getAttribute('href'), '/');
  await deep.close();
  assert.deepEqual(errors, []);
  console.log(`${engine}: navegación, encuadres, scroll reversible, cuadro final, enlaces y fallbacks OK.`);
} finally {
  await browser.close();
}
