import { createApiClient } from '@storyblok/api-client';
import { HOME_SLUG } from './content.ts';
import { deliveryHosts } from './preview.ts';

type Region = keyof typeof deliveryHosts;
type Version = 'published' | 'draft';
type Options = { timeout?: number; request?: typeof fetch };
const storyPath = `/v2/cdn/stories/${HOME_SLUG}`;
const spacePath = '/v2/cdn/spaces/me';

export function createHomeDeliveryClient(
  accessToken: string, region: string | undefined, version: Version,
  { timeout = 3800, request = fetch }: Options = {},
) {
  const code = region ?? 'eu';
  if (!Object.hasOwn(deliveryHosts, code)) throw new Error('Región de Storyblok no admitida.');
  const origin = `https://${deliveryHosts[code as Region]}`;
  const authorized = (url: URL) => url.origin === origin && !url.username && !url.password && !url.hash &&
    url.searchParams.getAll('token').length === 1 && url.searchParams.get('token') === accessToken;

  const guardedFetch: typeof fetch = async (input, init) => {
    const original = new Request(input, init);
    const url = new URL(original.url);
    const isStory = url.pathname === storyPath;
    if (original.method !== 'GET' || !authorized(url) || (!isStory && url.pathname !== spacePath) ||
      (isStory && (url.searchParams.getAll('version').length !== 1 || url.searchParams.get('version') !== version))) {
      throw new Error('Solicitud de Storyblok no autorizada.');
    }
    if (!isStory || version === 'draft') return request(original, { redirect: 'error' });

    // El SDK arma la consulta; este transporte solo valida el 301 documentado del CDN.
    const response = await request(original, { redirect: 'manual' });
    if (response.status !== 301) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    const next = location && new URL(location, url);
    if (!next || !authorized(next) || next.pathname !== storyPath || next.href === url.href ||
      next.searchParams.getAll('version').length !== 1 || next.searchParams.get('version') !== 'published' ||
      next.searchParams.getAll('cv').length !== 1 || !/^\d+$/.test(next.searchParams.get('cv') ?? '') ||
      [...next.searchParams.keys()].some((key) => !['token', 'version', 'cv'].includes(key))) {
      throw new Error('Redirección de Storyblok no autorizada.');
    }
    return request(new Request(next, original), { redirect: 'error' });
  };

  return createApiClient({
    accessToken,
    region: code as Region,
    fetch: guardedFetch,
    timeout,
    retry: { limit: 0 },
    cache: { cv: 'manual', strategy: 'network-first' },
  });
}
