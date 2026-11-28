import { HOME_SLUG, resolveHomeBlock } from '../src/lib/content.ts';
import { readEnvironment, storyFromDelivery } from './storyblok-env.mjs';

const version = process.argv.includes('--publicado') ? 'published' : 'draft';
const tokenName = version === 'draft' ? 'Preview' : 'Public';
try {
  const env = readEnvironment();
  const token = version === 'draft' ? env.STORYBLOK_PREVIEW_TOKEN : env.STORYBLOK_PUBLIC_TOKEN;
  const region = env.STORYBLOK_REGION ?? 'eu';
  const { status, story, spaceId } = await storyFromDelivery(token, region, version, true);
  if (!status) {
    console.error(`No se pudo conectar con Delivery API (${tokenName}, región ${region}).`);
    process.exitCode = 1;
  } else if (status === 401 || status === 403) {
    console.error(`Delivery API rechazó el token ${tokenName} (HTTP ${status}). Revisá el tipo de token, el Space y la región.`);
    process.exitCode = 1;
  } else if (story?.full_slug !== HOME_SLUG) {
    console.error(`No se encontró ${HOME_SLUG} en ${version} (Delivery API: HTTP ${status}).`);
    process.exitCode = 1;
  } else if (env.STORYBLOK_SPACE_ID && String(spaceId) !== env.STORYBLOK_SPACE_ID) {
    console.error('No se pudo verificar que el token corresponda a STORYBLOK_SPACE_ID.');
    process.exitCode = 1;
  } else if (!resolveHomeBlock(story.content)) {
    console.error(`La Story responde, pero no contiene el bloque ${HOME_SLUG} en la raíz ni en Body.`);
    process.exitCode = 1;
  } else {
    const placement = story.content?.component === HOME_SLUG ? 'raíz' : 'Body';
    console.log(`Conexión OK: ${HOME_SLUG} · ${version} · región ${region} · bloque en ${placement}.`);
    if (!env.STORYBLOK_SPACE_ID) console.log('Configurá STORYBLOK_SPACE_ID para comprobar que el token sea del Space correcto.');
    if (!story.published_at) console.log('La Story no está publicada.');
  }
} catch {
  console.error(`Revisá STORYBLOK_${tokenName.toUpperCase()}_TOKEN y STORYBLOK_REGION en .env.`);
  process.exitCode = 1;
}
