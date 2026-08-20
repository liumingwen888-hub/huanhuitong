FROM node:24-slim AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY apps/platform/package.json apps/platform/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
RUN corepack enable pnpm && pnpm install --frozen-lockfile=false --filter @xht/platform
COPY packages/ packages/
COPY apps/platform/ apps/platform/
RUN pnpm --filter @xht/platform build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/platform/dist ./dist
COPY --from=build /repo/apps/platform/package.json ./package.json
COPY --from=build /repo/packages/contracts/dist ./node_modules/@xht/contracts/
COPY --from=build /repo/packages/config/dist ./node_modules/@xht/config/
EXPOSE 3000
CMD ["node", "dist/main.js"]
