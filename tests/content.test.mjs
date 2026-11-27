import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HOME_SLUG, PRODUCT_BLOCK, SCENE_BLOCK, homeContent, resolveHomeBlock, safeHref } from '../src/lib/content.ts';
import { isSignedPreview } from '../src/lib/preview.ts';
import { DEFAULT_MARKS, SCENE_IDS, SCROLL_STOP, filmTime, originsCardEntry, readableStop, sceneAt, scenePose } from '../src/lib/timeline.ts';
import { components, isEmptyDefaultDraft, seedContent } from '../scripts/storyblok-model.mjs';

test('las cinco escenas y los cuatro cafés tienen fallback sin Storyblok', () => {
  const baseline = homeContent();
  assert.deepEqual(baseline.scenes.map(({ id }) => id), [...SCENE_IDS]);
  assert.deepEqual(baseline.products.map(({ name }) => name), ['Brasil', 'Colombia', 'Perú', 'Prestige']);
  assert.deepEqual(homeContent({ component: 'default-page', meta_title: 'Otra Story' }), baseline);
  assert.deepEqual(baseline.film.desktopMarks, [...DEFAULT_MARKS]);
  assert.equal(baseline.film.desktopLoop, '/media/cabrales-loop-desktop.mp4');
  assert.equal(baseline.film.mobileLoop, '/media/cabrales-loop-mobile.mp4');
  assert.equal(baseline.scenes.at(-1).actions[0].label, 'Agendar reunión');
});

test('Storyblok puede cambiar el texto, la foto, los enlaces y los dos montajes por separado', () => {
  const home = homeContent({
    component: HOME_SLUG,
    video_desktop: { filename: '//a.storyblok.com/video.mp4' },
    video_mobile: { filename: 'javascript:alert(1)' },
    scenes: [
      { component: SCENE_BLOCK, scene_key: 'cafe', title: 'Desde el editor', end_desktop: '3.15', end_mobile: 10 },
      { component: SCENE_BLOCK, scene_key: 'origenes', title: 'Un café para vos', primary_link: { linktype: 'url', url: 'https://tienda.cabrales.com/' } },
      { component: 'scene-item', scene_key: 'molido', title: 'No cargar' },
    ],
    products: [{ component: PRODUCT_BLOCK, name: 'Variedad', image: { filename: 'https://a.storyblok.com/variedad.webp', alt: 'Una foto' } }],
  });
  assert.equal(home.scenes[0].title, 'Desde el editor');
  assert.equal(home.scenes[1].title, 'para cada forma de preparar');
  assert.equal(home.scenes[3].actions[0].href, 'https://tienda.cabrales.com/');
  assert.equal(home.products.length, 1);
  assert.equal(home.products[0].image.alt, 'Una foto');
  assert.equal(home.film.desktop, 'https://a.storyblok.com/video.mp4');
  assert.equal(home.film.desktopLoop, undefined, 'no se empalma un clip editorial con el loop local');
  assert.equal(home.film.mobile, '/media/cabrales-scroll-mobile.mp4');
  assert.equal(home.film.mobileLoop, '/media/cabrales-loop-mobile.mp4');
  const otherMobile = homeContent({ component: HOME_SLUG, video_mobile: '/media/alternativo.mp4' });
  assert.equal(otherMobile.film.mobileLoop, undefined, 'no se empalma un clip editorial con el loop local');
  assert.equal(home.film.desktopMarks[1], 3.15);
  // Reject a descending list of times rather than desynchronizing a chapter.
  const invalid = homeContent({ component: HOME_SLUG, scenes: [{ component: SCENE_BLOCK, scene_key: 'cafe', end_desktop: '13' }] });
  assert.deepEqual(invalid.film.desktopMarks, [...DEFAULT_MARKS]);
});

test('la home dedicada conserva sus campos y respaldos cuando está dentro de Body', () => {
  const inner = {
    component: HOME_SLUG,
    _uid: 'home-editorial',
    logo: { filename: '/marca-editorial.webp' },
    video_mobile: '/montaje-editorial.mp4',
    scroll_hint: 'Explorá el café',
    scenes: [{ component: SCENE_BLOCK, scene_key: 'cafe', title: 'Café desde Storyblok', end_desktop: 3.1 }],
    products: [{ component: PRODUCT_BLOCK, product_key: 'brasil', name: 'Brasil del editor' }],
    products_label: 'Nuestros cafés',
    footer_tagline: 'De la costa a tu taza',
    meta_title: 'Cafés de origen | Cabrales',
  };
  const loose = [
    { component: SCENE_BLOCK, scene_key: 'molido', title: 'Escena por fuera del bloque' },
    { component: PRODUCT_BLOCK, name: 'Café por fuera del bloque' },
  ];
  const wrapper = { component: 'default-page', meta_title: 'Título del contenedor', body: [null, ...loose, inner] };
  assert.equal(resolveHomeBlock(wrapper), inner, 'se conserva la identidad del bloque para el Visual Editor');
  assert.deepEqual(homeContent(wrapper), homeContent(inner));
  const home = homeContent(wrapper);
  assert.equal(home.scenes[0].title, 'Café desde Storyblok');
  assert.equal(home.scenes[1].title, 'para cada forma de preparar');
  assert.deepEqual(home.products.map((product) => product.name), ['Brasil del editor']);
  assert.equal(home.products[0].image.src, '/media/pack-brasil.webp');
  assert.equal(home.logo.src, '/marca-editorial.webp');
  assert.equal(home.hint, 'Explorá el café');
  assert.equal(home.navigation[0].label, 'Nuestros cafés');
  assert.equal(home.footer.tagline, 'De la costa a tu taza');
  assert.equal(home.meta.title, 'Cafés de origen | Cabrales');
  assert.equal(home.film.desktopMarks[1], 3.1);
  assert.equal(home.film.desktopLoop, '/media/cabrales-loop-desktop.mp4');
  assert.equal(home.film.mobileLoop, undefined);

  assert.equal(homeContent({ ...inner, body: [{ ...inner, meta_title: 'No tiene prioridad' }] }).meta.title, inner.meta_title);
  assert.deepEqual(homeContent({ ...wrapper, body: loose }), homeContent());
  assert.deepEqual(homeContent({ ...wrapper, body: inner }), homeContent(), 'Body debe ser una lista de bloques');
});

test('los destinos editoriales solamente permiten rutas, anclas, HTTPS, teléfono y correo', () => {
  for (const unsafe of ['javascript:alert(1)', '//other.example/', '\\evil.example', '/\\evil.example/', 'http://other.example/', 'https://user@other.example/', '#', '/\nother']) {
    assert.equal(safeHref(unsafe), '', unsafe);
  }
  for (const valid of ['#productos', '/locales/', 'tel:+542234916363', 'mailto:cafe@cabrales.com', 'https://tienda.cabrales.com/']) {
    assert.equal(safeHref(valid), valid);
  }
});

test('el video sigue los cinco tramos, reacciona hacia atrás y congela el último cuadro', () => {
  const duration = 541 / 24;
  assert.deepEqual(SCROLL_STOP.map(sceneAt), [0, 1, 2, 3, 4, 4]);
  for (let i = 0; i < DEFAULT_MARKS.length; i++) assert.equal(filmTime(SCROLL_STOP[i], duration), DEFAULT_MARKS[i]);
  const descending = [.99, .83, .72, .56, .35, .13, 0].map((value) => filmTime(value, duration));
  assert.equal(descending[0], 22.5);
  assert.ok(descending.every((time, i) => i === 0 || time < descending[i - 1]));
  assert.equal(filmTime(.85, duration), filmTime(1, duration));
  assert.ok(filmTime(1, 10) < 10);
  assert.equal(scenePose(.2).opacity, 0);
  assert.equal(scenePose(0).opacity, 1);
  assert.equal(scenePose(.95).blur, 16);
});

test('la entrada de las tarjetas sigue el scroll y termina antes del ancla de productos', () => {
  assert.equal(originsCardEntry(SCROLL_STOP[3]), 0);
  const early = originsCardEntry(.68);
  const late = originsCardEntry(.71);
  assert.ok(0 < early && early < late && late < 1);
  assert.equal(originsCardEntry(readableStop(3)), 1);
  assert.equal(originsCardEntry(.68), early);
});

test('solo se habilita el Visual Editor con una firma vigente para el Space correcto', () => {
  const key = 'dev-only-test-key';
  const space = '12345';
  const now = 1_790_000_000;
  function preview(timestamp, signingSpace = space) {
    const hash = createHash('sha1').update(`${signingSpace}:${key}:${timestamp}`).digest('hex');
    const url = new URL('https://example.test/cabrales-home-v2');
    url.search = new URLSearchParams({
      _storyblok: '17',
      '_storyblok_tk[space_id]': signingSpace,
      '_storyblok_tk[timestamp]': String(timestamp),
      '_storyblok_tk[token]': hash,
    }).toString();
    return url;
  }
  const valid = preview(now - 120);
  assert.ok(isSignedPreview(valid, key, space, now));
  assert.equal(isSignedPreview(preview(now - 3700), key, space, now), false);
  assert.equal(isSignedPreview(preview(now + 90), key, space, now), false);
  assert.equal(isSignedPreview(preview(now - 120, '6789'), key, space, now), false);
  assert.equal(isSignedPreview(valid, 'wrong', space, now), false);
  valid.searchParams.delete('_storyblok');
  assert.equal(isSignedPreview(valid, key, space, now), false);
});

test('el modelo dedicado no cambia el tipo compartido ni pisa contenido existente', () => {
  assert.deepEqual(components.map(({ name }) => name), [PRODUCT_BLOCK, SCENE_BLOCK, HOME_SLUG]);
  const home = homeContent(seedContent());
  assert.equal(home.scenes.length, 5);
  assert.equal(home.products.length, 4);
  assert.deepEqual(home.film.desktopMarks, [...DEFAULT_MARKS]);
  const blank = { full_slug: HOME_SLUG, slug: HOME_SLUG, published: false, content: { component: 'default-page', body: [] } };
  assert.ok(isEmptyDefaultDraft(blank));
  assert.equal(isEmptyDefaultDraft({ ...blank, published: true }), false);
  assert.equal(isEmptyDefaultDraft({ ...blank, full_slug: 'cabrales' }), false);
  assert.equal(isEmptyDefaultDraft({ ...blank, content: { ...blank.content, meta_title: 'Editorial' } }), false);
});

function mp4Boxes(bytes, from = 0, until = bytes.length) {
  const list = [];
  for (let pos = from; pos + 8 <= until;) {
    const len = bytes.readUInt32BE(pos) || until - pos;
    assert.ok(len >= 8 && pos + len <= until);
    list.push({ type: bytes.toString('ascii', pos + 4, pos + 8), from: pos + 8, until: pos + len });
    pos += len;
  }
  return list;
}

function assertSilentVideo(result, width, height, frames) {
  const root = mp4Boxes(result);
  const get = (parent, type) => mp4Boxes(result, parent.from, parent.until).find((box) => box.type === type);
  const movie = root.find((box) => box.type === 'moov');
  assert.ok(movie && movie.until < root.find((box) => box.type === 'mdat').from, 'faststart');
  assert.equal(mp4Boxes(result, movie.from, movie.until).filter((item) => item.type === 'trak').length, 1, 'sin audio');
  const track = get(movie, 'trak'), header = get(track, 'tkhd');
  assert.equal(result.readUInt32BE(header.until - 8) / 65536, width);
  assert.equal(result.readUInt32BE(header.until - 4) / 65536, height);
  const samples = get(get(get(track, 'mdia'), 'minf'), 'stbl');
  const timeTable = get(samples, 'stts');
  const clock = get(get(track, 'mdia'), 'mdhd');
  const ticks = result.readUInt32BE(clock.from + 12);
  assert.equal(result.readUInt32BE(timeTable.from + 8), frames);
  assert.equal(ticks / result.readUInt32BE(timeTable.from + 12), 24);
  return get(samples, 'stss');
}

test('cada variante es más liviana que su original, arranca por HTTP y conserva el montaje all-intra', async () => {
  for (const [target, master, width, height, maxRatio] of [
    ['desktop', 'web', 1440, 810, .85], ['mobile', 'mobile', 720, 1280, .7],
  ]) {
    const source = await readFile(new URL(`../video-cabrales-home-scroll-${master}.mp4`, import.meta.url));
    const result = await readFile(new URL(`../public/media/cabrales-scroll-${target}.mp4`, import.meta.url));
    assert.ok(result.length < source.length * maxRatio, `${target} supera su presupuesto de peso`);
    const sync = assertSilentVideo(result, width, height, 541);
    if (sync) assert.equal(result.readUInt32BE(sync.from + 4), 541);
  }
});

test('el loop móvil es liviano, silencioso y mantiene el encuadre de su montaje', async () => {
  const result = await readFile(new URL('../public/media/cabrales-loop-mobile.mp4', import.meta.url));
  assert.ok(result.length < 1_000_000, 'el loop móvil supera su presupuesto de peso');
  assertSilentVideo(result, 720, 1280, 100);
});

test('el loop de escritorio conserva los 69 cuadros del corte y no tiene audio', async () => {
  const result = await readFile(new URL('../public/media/cabrales-loop-desktop.mp4', import.meta.url));
  assert.ok(result.length < 600_000, 'el loop de escritorio supera su presupuesto de peso');
  assertSilentVideo(result, 1280, 720, 69);
});
