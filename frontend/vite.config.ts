import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // Wails/桌面端需要相对路径，避免生产包里出现 /assets 导致空白页
  base: './',
  plugins: [react()]
})
