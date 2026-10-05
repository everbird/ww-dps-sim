// web/app/vite.config.ts —— 网页（M6，TD-12）：Vite + Svelte 5 静态站，引擎在 Web Worker 里跑。
// 生成数据（data/generated）不进 git、不发布，所以只在本机用：pnpm web 起开发服务器，直接读仓库里的文件。
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repo = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte()],
  server: { port: 5317, fs: { allow: [repo] } },
  build: { outDir: fileURLToPath(new URL('../../out/web', import.meta.url)), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
})
