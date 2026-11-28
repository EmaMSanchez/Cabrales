import { createHash, timingSafeEqual } from 'node:crypto';

/** Validate Storyblok's one-hour Visual Editor signature. Never expose the preview key. */
export function isSignedPreview(url: URL, token?: string, spaceId?: string, now = Date.now() / 1000) {
  if (!token || !spaceId) return false;
  const params = url.searchParams;
  const requestSpace = params.get('_storyblok_tk[space_id]');
  const timestamp = params.get('_storyblok_tk[timestamp]') ?? '';
  const signature = params.get('_storyblok_tk[token]') ?? '';
  if (!/^\d+$/.test(requestSpace ?? '') || spaceId !== requestSpace ||
      !/^\d{10}$/.test(timestamp) || !/^[a-f\d]{40}$/i.test(signature) ||
      Number(timestamp) <= now - 3600 || Number(timestamp) > now + 60 ||
      !/^\d+$/.test(params.get('_storyblok') ?? '')) return false;

  const expected = createHash('sha1').update(`${spaceId}:${token}:${timestamp}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export const deliveryHosts = {
  eu: 'api.storyblok.com',
  us: 'api-us.storyblok.com',
  ca: 'api-ca.storyblok.com',
  ap: 'api-ap.storyblok.com',
} as const;
