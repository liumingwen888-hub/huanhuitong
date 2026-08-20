FROM node:24-slim AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN corepack enable pnpm && pnpm install --frozen-lockfile=false --filter @xht/worker
COPY packages/ packages/
COPY apps/worker/ apps/worker/
RUN pnpm --filter @xht/worker build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/package.json ./package.json
COPY --from=build /repo/packages/contracts/dist ./node_modules/@xht/contracts/
COPY --from=build /repo/packages/config/dist ./node_modules/@xht/config/
CMD ["node", "dist/main.js"]
