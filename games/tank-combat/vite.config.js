import { defineConfig } from 'vite';

// Relative base so the build works from any subpath (e.g. GitHub Pages project sites).
// three.js is not bundled: the built page loads it from jsDelivr via the importmap in index.html
// (keep the importmap version in sync with package.json).
export default defineConfig({
  base: './',
  build: { rollupOptions: { external: [/^three(\/.*)?$/] } },
});
