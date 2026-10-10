import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['leaf.svg'],
      manifest: {
        name: 'Daily Dose of Nature',
        short_name: 'Nature Dose',
        description: 'A little offline-first invitation to step outside.',
        theme_color: '#f4f0e6',
        background_color: '#f4f0e6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/leaf.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        globIgnores: ['**/llm-runtime-*.js', '**/data/berlin-pack.json'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/data\/berlin-pack\.json$/.test(String(url)),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nature-data-pack',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              plugins: [{
                cacheWillUpdate: async ({ response }) =>
                  response.headers.get('content-type')?.includes('application/json') ? response : null,
              }],
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/llm-runtime-[^/]+\.js$/.test(String(url)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'local-model-runtime',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@mlc-ai/web-llm/')) return 'llm-runtime';
        },
      },
    },
  },
});
