import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 强制 Vite 无论在哪里遇到 react 和 react-dom，都只使用同一个单例
    dedupe: ['react', 'react-dom'],
  },
})