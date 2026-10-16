import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };   // @types/node 없이 — 빌드 환경 변수만 읽는다

// 배포마다 바뀌는 빌드 번호 — 화면이 /version.json 과 견줘 «새 버전» 알림을 띄운다(10-16 사용자 «vercel 업뎃하면 새로고침 뜨게»).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now());

export default defineConfig({
  plugins: [react(), {
    name: "emit-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  }],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { sourcemap: true },
});
