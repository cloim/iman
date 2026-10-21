# 이만 API + 웹 정적 파일 단일 이미지. 빌드 컨텍스트는 저장소 루트
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
COPY db db
COPY fixtures fixtures
RUN pnpm --filter @iman/web exec vite build \
 && pnpm --filter @iman/api build \
 && pnpm --filter @iman/api deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/web/dist ./web
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 47210) + '/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
