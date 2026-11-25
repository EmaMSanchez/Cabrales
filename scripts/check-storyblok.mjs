import { HOME_SLUG } from '../src/lib/content.ts';
import { readEnvironment, storyFromDelivery } from './storyblok-env.mjs';

try {
  const env = readEnvironment();
  const version = process.argv.includes('--publicado') ? 'published' : 'draft';
  const { status, story } = await storyFromDelivery(version === 'draft' ? env.STORYBLOK_PREVIEW_TOKEN : env.STORYBLOK_PUBLIC_TOKEN, env.STORYBLOK_REGION, version);
  if (!story || story.full_slug !== HOME_SLUG) {
    console.error(`No se encontró ${HOME_SLUG} en ${version} (Delivery API: HTTP ${status}).`);
    process.exitCode = 1;
  } else {
    console.log(`Conexión OK: ${story.full_slug} · ${version} · tipo ${story.content?.component}.`);
    if (story.content?.component !== HOME_SLUG) console.log('El borrador todavía no tiene el tipo Cabrales · Home V2. Se muestran los contenidos locales.');
    if (!story.published_at) console.log('La Story no está publicada.');
  }
} catch (error) {
  console.error(error.name === 'TypeError' || error.name === 'TimeoutError' ? 'No se pudo conectar con Delivery API.' : error.message);
  process.exitCode = 1;
}
