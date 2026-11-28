import {
  SITE_INDEXABLE,
  SITE_URL,
  STORYBLOK_PREVIEW_TOKEN,
  STORYBLOK_PUBLIC_TOKEN,
  STORYBLOK_REGION,
  STORYBLOK_SPACE_ID,
} from 'astro:env/server';
import { storyblokEditable } from '@storyblok/astro';
import { HOME_SLUG, resolveHomeBlock, type Blok } from './content.ts';
import { isSignedPreview } from './preview.ts';
import { createHomeDeliveryClient } from './storyblok-delivery.ts';

export function editorAttributes(block: Blok | undefined, editing: boolean) {
  if (!editing || !block?._editable) return {};
  return storyblokEditable(block);
}

function canonicalURL() {
  if (!SITE_URL) return undefined;
  try {
    const url = new URL(SITE_URL);
    if (url.protocol === 'https:' && !url.username && !url.password) return new URL('/', url);
  } catch { /* Invalid deployment setting: omit the canonical. */ }
}

export async function readHome(url: URL) {
  const editing = isSignedPreview(url, STORYBLOK_PREVIEW_TOKEN, STORYBLOK_SPACE_ID);
  const draft = import.meta.env.DEV || editing;
  const token = draft ? STORYBLOK_PREVIEW_TOKEN : STORYBLOK_PUBLIC_TOKEN;
  let block: Blok | undefined;
  let connected = false;

  if (token) {
    try {
      const version = draft ? 'draft' : 'published';
      const client = createHomeDeliveryClient(token, STORYBLOK_REGION, version);
      const { data, error, response } = await client.stories.get(HOME_SLUG, { query: { version } });
      const story = data?.story;
      if (story?.full_slug === HOME_SLUG && (!editing || String(story.id) === url.searchParams.get('_storyblok'))) {
        connected = Boolean(story.content);
        block = resolveHomeBlock(story.content);
      } else if (error && response.status !== 404) {
        console.warn(response.status
          ? `[Storyblok] Delivery API respondió con HTTP ${response.status} (${version}).`
          : `[Storyblok] Delivery API no disponible (${version}); se muestra el contenido local.`);
      }
    } catch {
      console.warn('[Storyblok] Delivery API no disponible; se muestra el contenido local.');
    }
  }

  const canonical = canonicalURL();
  return {
    block, connected, editing: editing && connected, draft, canonical,
    indexable: !draft && connected && block?.component === HOME_SLUG && SITE_INDEXABLE === 'true' && Boolean(canonical) && url.pathname === '/',
  };
}

export type Delivery = Awaited<ReturnType<typeof readHome>>;

export function deliveryHeaders(headers: Headers, delivery: Delivery) {
  headers.set('Cache-Control', delivery.draft ? 'private, no-store' : 'public, max-age=0, s-maxage=60');
  headers.set('Content-Security-Policy', `frame-ancestors ${delivery.editing ? 'https://app.storyblok.com' : "'none'"}`);
  headers.set('Referrer-Policy', delivery.editing ? 'no-referrer' : 'strict-origin-when-cross-origin');
  if (!delivery.indexable) headers.set('X-Robots-Tag', 'noindex, nofollow');
}
