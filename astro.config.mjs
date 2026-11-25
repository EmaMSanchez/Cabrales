import { defineConfig, envField } from 'astro/config';
import netlify from '@astrojs/netlify';
import node from '@astrojs/node';
import mkcert from 'vite-plugin-mkcert';

const editorMode = process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'editor';
const env = (options) => envField.string({ context: 'server', access: 'secret', ...options });

export default defineConfig({
  output: 'server',
  adapter: process.env.NETLIFY === 'true' ? netlify() : node({ mode: 'standalone' }),
  session: false,
  devToolbar: { enabled: false },
  server: { host: 'localhost', port: 4321 },
  env: {
    schema: {
      STORYBLOK_PREVIEW_TOKEN: env({ optional: true }),
      STORYBLOK_PUBLIC_TOKEN: env({ optional: true }),
      STORYBLOK_REGION: env({ default: 'eu' }),
      STORYBLOK_SPACE_ID: env({ optional: true }),
      SITE_URL: env({ optional: true }),
      SITE_INDEXABLE: env({ default: 'false' }),
    },
  },
  vite: { plugins: editorMode ? [mkcert()] : [] },
});
