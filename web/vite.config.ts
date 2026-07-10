import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/stellar-launchpad/ in CI, from / locally.
const base = process.env.GITHUB_ACTIONS ? '/stellar-launchpad/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
});
