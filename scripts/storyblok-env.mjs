import { HOME_SLUG } from '../src/lib/content.ts';
import { createHomeDeliveryClient } from '../src/lib/storyblok-delivery.ts';

export function readEnvironment() {
  try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return process.env;
}

export async function storyFromDelivery(token, region, version = 'draft', checkSpace = false) {
  if (!token) throw new Error(`Falta el token ${version === 'draft' ? 'Preview' : 'Public'} de Delivery API.`);
  const client = createHomeDeliveryClient(token, region, version, { timeout: 7000 });
  const [{ data, response }, space] = await Promise.all([
    client.stories.get(HOME_SLUG, { query: { version } }),
    checkSpace ? client.spaces.get() : undefined,
  ]);
  return { status: response.status, story: data?.story, spaceId: space?.data?.space?.id };
}
