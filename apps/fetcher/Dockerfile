# The fetch worker: Node + Chromium (for Zepto / Instamart) + impit (for Blinkit).
# Build from the repo root so the engine workspace is available:
#   docker build -f apps/fetcher/Dockerfile -t jhola-fetcher .
#   docker run -p 4100:4100 -e FETCHER_SECRET=… jhola-fetcher
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/fetcher/package.json apps/fetcher/
# tsx runs the TypeScript directly, and it is a dev dependency, so include dev deps.
RUN npm ci --include=dev --workspace @gc/fetcher --workspace @gc/engine

COPY packages/engine packages/engine
COPY apps/fetcher apps/fetcher

EXPOSE 4100
CMD ["npx", "tsx", "apps/fetcher/src/server.ts"]
