FROM node:24-slim AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY apps/admin-web/package.json apps/admin-web/
RUN corepack enable pnpm && pnpm install --frozen-lockfile=false --filter @xht/admin-web
COPY apps/admin-web/ apps/admin-web/
RUN pnpm --filter @xht/admin-web exec vite build --outDir dist

FROM nginx:1.27-alpine AS runtime
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
