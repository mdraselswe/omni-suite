# OmniSuite production image. Build: docker build -t omnisuite .
# Runs `next start` on port 3000; migrations apply on boot (AUTO_MIGRATE=true).
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM base AS run
ENV NODE_ENV=production PORT=3000
RUN groupadd --system app && useradd --system --gid app --home /app app \
  && mkdir -p /app/storage && chown app:app /app/storage
COPY --from=build --chown=app:app /app/package.json /app/next.config.ts ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
VOLUME ["/app/storage"]
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
