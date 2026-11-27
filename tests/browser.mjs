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
  await page.waitForFunction(({ expected, chapter, flowing }) => {
    const journey = document.querySelector('cabrales-journey');
    const video = journey.querySelector('.journey__video');
    return journey.hasAttribute('data-frame-ready') && journey.dataset.chapter === chapter &&
      (!flowing || !journey.hasAttribute('data-loop-visible')) &&
      !video.seeking && Math.abs(video.currentTime - expected) < .13;
  }, { expected, chapter, flowing: progress > 0 });
  assert.equal(await page.locator('.scene[data-active]').count(), 1);
  assert.equal(await page.locator('.scene[inert]').count(), 4);
  const film = page.locator('.journey__video');
  assert.equal(await film.evaluate((v) => v.paused), true);
  if (progress > 0) {
    assert.equal(await page.locator('.journey__loop').evaluate((v) => v.paused), true);
    assert.equal(await page.locator('cabrales-journey').getAttribute('data-loop-visible'), null);
  }
  return film.evaluate((v) => v.currentTime);
}

async function intro(page, variant = 'mobile') {
  await page.waitForFunction(() => {
    const journey = document.querySelector('cabrales-journey');
    const loop = journey.querySelector('.journey__loop');
    return journey.hasAttribute('data-loop-visible') && !loop.paused && loop.currentTime > .04;
  });
  const loop = page.locator('.journey__loop');
  assert.equal(await loop.evaluate((video) => new URL(video.currentSrc).pathname), `/media/cabrales-loop-${variant}.mp4`);
  assert.equal(await loop.evaluate((video) => video.muted && video.loop && video.playsInline), true);
}

function videoRequests(page) {
  const paths = new Set();
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/media\/cabrales-(scroll|loop)-/.test(pathname)) paths.add(pathname);
  });
  return paths;
}

async function checkSource(page, paths, variant) {
  const film = `/media/cabrales-scroll-${variant}.mp4`;
  assert.equal(await page.locator('.journey__video').evaluate((video) => new URL(video.currentSrc).pathname), film);
  const expected = new Set([film, `/media/cabrales-loop-${variant}.mp4`]);
  // WebKit on Windows fetches the video through its native media pipeline, outside Playwright's network events.
  if (engine === 'chromium' || paths.size) assert.deepEqual(paths, expected);
}

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

async function cardPoses(page) {
  return page.locator('.product-card').evaluateAll((cards) => cards.map((card) => {
    const style = getComputedStyle(card);
    const matrix = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
    const { top, bottom } = card.getBoundingClientRect();
    return {
      top, bottom, opacity: Number(style.opacity), scale: matrix.a, offsetX: matrix.e,
      upright: Math.abs(matrix.b) < .0001 && Math.abs(matrix.c) < .0001,
      interactive: !card.closest('[inert]'),
    };
  }));
}

async function primaryActionOffset(page, id) {
  return page.locator(`#${id} .scene__actions .button`).first().evaluate((button) =>
    button.getBoundingClientRect().left - button.parentElement.getBoundingClientRect().left);
}

async function checkMolidoTitle(page) {
  await page.evaluate(() => document.fonts.ready);
  const lines = await page.locator('#molido .scene__title').evaluate((title) => {
    const text = title.firstChild;
    const split = text.textContent.lastIndexOf(' ');
    const range = new Range();
    range.setStart(text, 0);
    range.setEnd(text, split);
    const first = [...range.getClientRects()];
    range.setStart(text, split + 1);
    range.setEnd(text, text.length);
    return {
      first: new Set(first.map((box) => Math.round(box.top))).size,
      distance: range.getBoundingClientRect().top - first[0].top,
      lineHeight: parseFloat(getComputedStyle(title).lineHeight),
    };
  });
  assert.equal(lines.first, 1, '«para cada forma de» se mantiene en la primera línea');
  assert.ok(Math.abs(lines.distance - lines.lineHeight) <= 1, '«preparar» sigue en el siguiente renglón');
}

async function screenshot(page, id) {
  if (!capture) return;
  await mkdir('reports/screenshots', { recursive: true });
  await page.screenshot({ path: `reports/screenshots/${engine}-${id}.png`, animations: 'disabled' });
}

try {
  const desk = await pageFor({ viewport: { width: 1440, height: 900 } });
  const deskVideo = videoRequests(desk);
  // The removed opt-out must no longer affect visitors who had previously used it.
  await desk.addInitScript(() => sessionStorage.setItem('cabrales.motion', 'still'));
  const response = await open(desk);
  assert.equal(response.headers()['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(await desk.locator('storyblok-preview').count(), 0);
  assert.equal(await desk.locator('[data-blok-uid]').count(), 0);
  assert.equal(await desk.locator('[data-motion-toggle], .motion-switch, [data-linear-link]').count(), 0);
  await intro(desk, 'desktop');
  const heading = desk.getByRole('heading', { level: 1, name: 'Café Cabrales', exact: true });
  assert.match(await heading.textContent(), /Café\s+Cabrales/);
  assert.equal(await heading.locator('img, svg').count(), 0);
  const { x: heroMargin } = await desk.locator('#inicio .scene__copy').boundingBox();
  assert.equal(await primaryActionOffset(desk, 'inicio'), -8);
  await screenshot(desk, 'desktop-inicio');
  await scene(desk, .025, 'cafe');
  const grind = await scene(desk, .31, 'molido');
  await checkMolidoTitle(desk);
  const { x, width } = await desk.locator('#molido .scene__copy').boundingBox();
  assert.ok(Math.abs(1440 - x - width - heroMargin) <= 1, 'Molido respeta el margen editorial del inicio');
  assert.equal(await primaryActionOffset(desk, 'molido'), -8);
  await screenshot(desk, 'desktop-molido');
  const bag = await scene(desk, .575, 'super');
  assert.equal(await primaryActionOffset(desk, 'super-cabrales'), -8);
  await screenshot(desk, 'desktop-super');

  await scene(desk, .68, 'origenes');
  const entering = await cardPoses(desk);
  assert.equal(entering.length, 4);
  assert.ok(entering.every(({ opacity, scale, upright, interactive }) => opacity > 0 && opacity < .7 && scale < 1 && upright && !interactive));
  assert.ok(entering.every(({ offsetX }, index) => index < 2 ? offsetX > 0 : offsetX < 0));
  const family = await scene(desk, .765, 'origenes');
  assert.equal(await primaryActionOffset(desk, 'productos'), -8);
  const settled = await cardPoses(desk);
  assert.ok(settled.every(({ opacity, scale, offsetX, upright, interactive }) => opacity === 1 && scale === 1 && offsetX === 0 && upright && interactive));
  assert.ok(settled[0].top + 24 < settled[1].top && settled[3].top + 24 < settled[2].top);
  assert.ok(Math.max(...settled.map(({ bottom }) => bottom)) < 750, 'las tarjetas quedan por encima de la base visual del Súper');
  await scene(desk, .68, 'origenes');
  assert.deepEqual(await cardPoses(desk), entering, 'la entrada de las tarjetas también se revierte al subir');

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
  assert.ok((await cardPoses(desk)).every(({ opacity, interactive }) => opacity === 1 && interactive));
  await screenshot(desk, 'desktop-origenes');
  await desk.keyboard.press('End');
  await desk.locator('.site-footer__up').click();
  assert.equal(new URL(desk.url()).hash, '#inicio');
  await scene(desk, 0, 'cafe');
  await intro(desk, 'desktop');
  await noOverflow(desk);
  await checkSource(desk, deskVideo, 'desktop');
  await desk.close();

  const mobile = await pageFor({
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const mobVideo = videoRequests(mobile);
  await open(mobile, '/cabrales-home-v2');
  await intro(mobile);
  assert.equal(await mobile.locator('#inicio picture img').evaluate((i) => new URL(i.currentSrc).pathname), '/media/cafe-mobile.webp');
  assert.equal(await primaryActionOffset(mobile, 'inicio'), -4);
  await screenshot(mobile, 'movil-inicio');
  await mobile.locator('.site-menu summary').tap();
  await mobile.locator('.site-menu__nav a[href="#productos"]').tap();
  assert.equal(await mobile.locator('.site-menu').getAttribute('open'), null);
  assert.equal(await mobile.locator('cabrales-journey').getAttribute('data-chapter'), 'origenes');
  await scene(mobile, .68, 'origenes');
  assert.ok((await cardPoses(mobile)).every(({ scale, upright, offsetX }, index) => scale < 1 && upright && (index % 2 === 0 ? offsetX > 0 : offsetX < 0)));
  await scene(mobile, .765, 'origenes');
  await noOverflow(mobile);
  for (const card of await mobile.locator('.product-card').all()) {
    const { x, y, width, height } = await card.boundingBox();
    assert.ok(x > 0 && x + width < 391 && y > 0 && y + height < 844);
  }
  await screenshot(mobile, 'movil-origenes');
  await scene(mobile, .951, 'reunion');
  assert.ok(await scene(mobile, .52, 'super') < 17);
  await scene(mobile, .31, 'molido');
  await checkMolidoTitle(mobile);
  await noOverflow(mobile);
  await screenshot(mobile, 'movil-molido');
  await scene(mobile, 0, 'cafe');
  await intro(mobile);
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
    assert.equal(await fallback.locator('video[src]').count(), 0, name);
    assert.ok((await cardPoses(fallback)).every(({ opacity, upright, interactive }) => opacity === 1 && upright && interactive), name);
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
  assert.equal(await failed.locator('video[src]').count(), 0);
  await failed.close();

  const blocked = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blocked.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.matches('.journey__loop')) return Promise.reject(new DOMException('Autoplay bloqueado', 'NotAllowedError'));
      return play.call(this);
    };
  });
  await open(blocked);
  await scene(blocked, 0, 'cafe');
  assert.equal(await blocked.locator('cabrales-journey').getAttribute('data-loop-visible'), null);
  await scene(blocked, .31, 'molido');
  await blocked.close();

  if (engine === 'chromium') {
    for (const variant of ['desktop', 'mobile']) {
      const isMobile = variant === 'mobile';
      const viewport = isMobile ? { width: 390, height: 844 } : { width: 1366, height: 768 };
      const delayed = await pageFor({ viewport, isMobile, hasTouch: isMobile });
      let releaseFilm;
      const buffering = new Promise((resolve) => { releaseFilm = resolve; });
      await delayed.route(`**/media/cabrales-scroll-${variant}.mp4`, async (route) => {
        await buffering;
        await route.continue();
      });
      await open(delayed);
      await intro(delayed, variant);
      await delayed.evaluate(() => scrollTo(0, 90));
      await delayed.waitForFunction(() => document.querySelector('.journey__loop').paused);
      assert.equal(await delayed.locator('cabrales-journey').getAttribute('data-loop-visible'), '');
      assert.equal(await delayed.locator('cabrales-journey').getAttribute('data-frame-ready'), null);
      releaseFilm();
      await scene(delayed, .031, 'cafe');
      await delayed.close();
    }
  }

  const deep = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await open(deep, '/#reunion');
  await deep.waitForFunction(() => document.querySelector('cabrales-journey').dataset.chapter === 'reunion');
  assert.equal(await deep.locator('.journey__loop').getAttribute('src'), null, 'un ancla interna no solicita el loop de entrada');
  const missing = await deep.goto(new URL('/no-existe', base).href);
  assert.equal(missing.status(), 404);
  assert.equal(await deep.getByRole('link', { name: 'Ir al inicio' }).getAttribute('href'), '/');
  await deep.close();
  assert.deepEqual(errors, []);
  console.log(`${engine}: navegación, encuadres, tarjetas, scroll reversible, cuadro final y fallbacks OK.`);
} finally {
  await browser.close();
}
