import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_SLUG, homeContent, SCENE_BLOCK } from '../src/lib/content.ts';
import { createHomeDeliveryClient } from '../src/lib/storyblok-delivery.ts';

const path = `/v2/cdn/stories/${HOME_SLUG}`;
const query = 'version=published&token=fixture-token';
const origin = 'https://api.storyblok.com';
const cached = `${path}?${query}&cv=1795884230`;
const redirect = (location) => new Response(null, { status: 301, headers: { location } });
const published = { query: { version: 'published' } };
const draft = { query: { version: 'draft' } };
const clientFor = (request, version = 'published') => createHomeDeliveryClient('fixture-token', 'eu', version, { request });

function story(title, cv) {
  return Response.json({ cv, story: { full_slug: HOME_SLUG, content: { component: 'default-page', body: [
    { component: HOME_SLUG, scenes: [{ component: SCENE_BLOCK, scene_key: 'cafe', title }] },
  ] } } });
}

test('el SDK sigue el 301 validado y lee nuevas publicaciones sin conservar un cv anterior', async () => {
  const requests = [];
  let cv = 1795884230;
  const client = clientFor(async (request, options) => {
    const url = new URL(request.url);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get('token'), 'fixture-token');
    assert.equal(url.searchParams.get('version'), 'published');
    const requestCv = url.searchParams.get('cv');
    requests.push({ cv: requestCv, redirect: options.redirect });
    return requestCv ? story(`Publicación ${cv}`, cv) : redirect(`${path}?${query}&cv=${cv}`);
  });
  for (let i = 0; i < 2; i++, cv++) {
    const { data, error, response } = await client.stories.get(HOME_SLUG, published);
    assert.equal(error, undefined);
    assert.equal(response.status, 200);
    assert.equal(homeContent(data.story.content).scenes[0].title, `Publicación ${cv}`);
  }
  assert.deepEqual(requests, [
    { cv: null, redirect: 'manual' }, { cv: '1795884230', redirect: 'error' },
    { cv: null, redirect: 'manual' }, { cv: '1795884231', redirect: 'error' },
  ]);
});

test('el SDK no sigue redirecciones con otro destino, versión, token o cv inválido', async () => {
  const cases = [
    `https://otro.example${cached}`,
    `https://api-us.storyblok.com${cached}`,
    `http://api.storyblok.com${cached}`,
    `https://usuario@api.storyblok.com${cached}`,
    cached.replace(HOME_SLUG, 'otra-story'),
    cached.replace('published', 'draft'),
    cached.replace('fixture-token', 'otro-token'),
    cached.replace('1795884230', 'invalido'),
    `${path}?${query}`,
    `${cached}&version=draft`,
    `${cached}&token=otro-token`,
    `${cached}&cv=1`,
    `${cached}&otro=parametro`,
  ];
  for (const destination of cases) {
    let requests = 0;
    const client = clientFor(async () => { requests++; return redirect(destination); });
    const result = await client.stories.get(HOME_SLUG, published);
    assert.ok(result.error);
    assert.equal(result.data, undefined);
    assert.equal(requests, 1, 'el destino no debe recibir ninguna solicitud');
  }
});

test('la lectura admite un solo 301 y no sigue un 302', async () => {
  const requests = [];
  const client = clientFor(async (request, options) => {
    requests.push({ url: request.url, mode: options.redirect });
    if (options.redirect === 'error') throw new TypeError('unexpected redirect');
    return redirect(cached);
  });
  assert.ok((await client.stories.get(HOME_SLUG, published)).error);
  assert.deepEqual(requests.map(({ mode }) => mode), ['manual', 'error']);

  let count = 0;
  const other = clientFor(async () => { count++; return Response.redirect(new URL(cached, origin), 302); });
  const result = await other.stories.get(HOME_SLUG, published);
  assert.equal(result.response.status, 302);
  assert.equal(count, 1);
});

test('el cliente de borradores y la consulta de Space no siguen redirecciones', async () => {
  const requests = [];
  const client = clientFor(async (request, options) => {
    assert.equal(options.redirect, 'error');
    const url = new URL(request.url);
    requests.push(url.pathname);
    if (url.pathname.endsWith('/spaces/me')) return Response.json({ space: { id: 12 } });
    assert.equal(url.searchParams.get('version'), 'draft');
    return story('Borrador', 1795884230);
  }, 'draft');
  assert.equal((await client.stories.get(HOME_SLUG, draft)).response.status, 200);
  assert.equal((await client.spaces.get()).data.space.id, 12);
  assert.ok((await client.stories.get(HOME_SLUG, published)).error);
  assert.deepEqual(requests, [path, '/v2/cdn/spaces/me']);
});
