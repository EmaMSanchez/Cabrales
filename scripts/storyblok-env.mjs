import { HOME_SLUG } from '../src/lib/content.ts';
import { deliveryHosts } from '../src/lib/preview.ts';

export function readEnvironment() {
  try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return process.env;
}

export async function storyFromDelivery(token, region, version = 'draft') {
  const host = deliveryHosts[region ?? 'eu'];
  if (!host) throw new Error('Región de Storyblok no admitida. Usá eu, us, ca o ap.');
  if (!token) throw new Error(`Falta el token ${version === 'draft' ? 'Preview' : 'Public'} de Delivery API.`);
  const url = new URL(`https://${host}/v2/cdn/stories/${HOME_SLUG}`);
  url.searchParams.set('token', token);
  url.searchParams.set('version', version);
  const response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'error' });
  return { status: response.status, story: response.ok ? (await response.json()).story : undefined };
}
