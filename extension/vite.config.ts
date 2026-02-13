import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        popup: resolve(__dirname, 'src/popup/popup.ts'),
        injected: resolve(__dirname, 'src/injected.ts'),
        settings: resolve(__dirname, 'src/settings/settings.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Put settings.js in settings/ directory
          if (chunkInfo.name === 'settings') {
            return 'settings/[name].js';
          }
          return '[name].js';
        },
        // Use IIFE for injected script (runs immediately, no module delay)
        // Use ES modules for everything else
        format: 'es',
        // Inline dynamic imports for injected script
        inlineDynamicImports: false,
      },
    },
    // Manifest V3 doesn't allow eval, ensure no dynamic code
    target: 'esnext',
    minify: false, // Easier debugging, enable in production
  },
  // Prevent any code that uses eval/new Function
  esbuild: {
    drop: ['debugger'],
  },
  plugins: [
    {
      name: 'copy-extension-files',
      closeBundle() {
        // Copy manifest.json
        copyFileSync('manifest.json', 'dist/manifest.json');

        // Copy popup.html and popup.css
        if (existsSync('src/popup/popup.html')) {
          copyFileSync('src/popup/popup.html', 'dist/popup.html');
        }
        if (existsSync('src/popup/popup.css')) {
          copyFileSync('src/popup/popup.css', 'dist/popup.css');
        }

        // Copy settings page
        if (!existsSync('dist/settings')) {
          mkdirSync('dist/settings', { recursive: true });
        }
        if (existsSync('src/settings/settings.html')) {
          copyFileSync('src/settings/settings.html', 'dist/settings/settings.html');
        }
      },
    },
  ],
});
