import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 用相对路径，方便以后直接丢到 GitHub Pages / 任意子目录
export default defineConfig({
  base: './',
  plugins: [react()],
})
