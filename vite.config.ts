import { defineConfig } from 'vite';

// GitHub Pages（https://hojo0729.github.io/kenchiku_cad/）で公開するときだけ、パスの接頭辞を付ける
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/kenchiku_cad/' : '/',
});
