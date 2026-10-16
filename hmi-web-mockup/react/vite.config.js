import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 통신·상태 로직(../js/)과 화면 모양(../css/)은 기존 HMI 파일을 그대로 불러 쓴다 — 개발 서버가 상위 폴더를 읽게 허용한다
export default defineConfig({
  plugins: [react()],
  base: './', // 어느 경로에 올려도 열리게 (메인 서버의 wwwroot 등)
  server: { port: 5174, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
