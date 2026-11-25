import { HOME_SLUG } from '../src/lib/content.ts';
import { readEnvironment, storyFromDelivery } from './storyblok-env.mjs';
import { components, isEmptyDefaultDraft, seedContent } from './storyblok-model.mjs';

const managementHosts = {
  eu: 'mapi.storyblok.com', us: 'mapi-us.storyblok.com',
  ca: 'mapi-ca.storyblok.com', ap: 'mapi-ap.storyblok.com',
};

async function main() {
  const env = readEnvironment();
  const apply = process.argv.includes('--apply');
  console.log(`${apply ? 'Aplicar' : 'Solo lectura'} · ${HOME_SLUG} · ${components.map(({ name }) => name).join(', ')}`);
  const { story } = await storyFromDelivery(env.STORYBLOK_PREVIEW_TOKEN, env.STORYBLOK_REGION);
  const key = story?.content?._editable?.match(/"space"\s*:\s*"?(\d+)/)?.[1];
  if (!story || story.full_slug !== HOME_SLUG || !Number.isSafeInteger(story.id) ||
      !/^\d+$/.test(env.STORYBLOK_SPACE_ID ?? '') || key !== env.STORYBLOK_SPACE_ID) {
    throw new Error('No coincide el borrador o el ID del Space con la respuesta del token Preview. No se hicieron cambios.');
  }

  const token = env.STORYBLOK_MANAGEMENT_TOKEN;
  if (!token) {
    const message = 'Falta STORYBLOK_MANAGEMENT_TOKEN. Hace falta un token personal con permisos para la Block Library y la Story.';
    if (apply) throw new Error(message);
    console.log(`Borrador encontrado por Delivery API. ${message}`);
    return;
  }
  const host = managementHosts[env.STORYBLOK_REGION ?? 'eu'];
  const base = `https://${host}/v1/spaces/${key}`;
  async function request(endpoint, method = 'GET', data) {
    const res = await fetch(`${base}/${endpoint}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: token, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`Management API respondió HTTP ${res.status} (${method} ${endpoint.split('?')[0]}). No se fuerza ninguna operación.`);
    return res.json();
  }

  const endpoint = `stories/${story.id}`;
  const target = (await request(endpoint)).story;
  if (target?.full_slug !== HOME_SLUG || target.id !== story.id || target.is_folder) {
    throw new Error('Management API no devolvió la misma Story. No se hicieron cambios.');
  }
  if (target.content?.component === HOME_SLUG) {
    console.log('La Story ya usa su tipo dedicado. No se reemplazan contenidos ni esquemas.');
    return;
  }
  if (!isEmptyDefaultDraft(target)) throw new Error('La Story no es un borrador default-page vacío. No se sobrescribe.');

  const { components: current } = await request(`components?search=${HOME_SLUG}`);
  const missing = components.filter((definition) => {
    const existing = current.find((item) => item.name === definition.name);
    if (!existing) return true;
    const compatible = existing.is_root === definition.is_root &&
      Object.entries(definition.schema).every(([key, value]) => existing.schema?.[key]?.type === value.type);
    if (!compatible) throw new Error(`El esquema existente de ${definition.name} no coincide. Revisalo antes de continuar.`);
    return false;
  });
  console.log(`Bloques a crear: ${missing.map(({ name }) => name).join(', ') || 'ninguno'}. Se completaría solo el borrador existente; no se publica nada.`);
  if (!apply) return;

  for (const component of missing) await request('components', 'POST', { component });
  const latest = (await request(endpoint)).story;
  if (!isEmptyDefaultDraft(latest) || target.updated_at !== latest.updated_at) {
    throw new Error('La Story cambió durante la operación. Se conservó su contenido.');
  }
  const updated = await request(endpoint, 'PUT', {
    story: { id: latest.id, name: latest.name, slug: latest.slug, content: seedContent() },
    publish: false,
  });
  if (updated.story?.content?.component !== HOME_SLUG) throw new Error('Storyblok no confirmó el contenido nuevo. Revisá el borrador en el panel.');
  console.log('Borrador configurado. Ahora podés cargar sus assets y activar su URL adicional de preview.');
}

main().catch((error) => {
  console.error(error.name === 'TypeError' || error.name === 'TimeoutError' ? 'No se pudo completar la conexión con Storyblok.' : error.message);
  process.exitCode = 1;
});
