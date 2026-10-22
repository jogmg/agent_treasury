# Build context is the repository root:
#   docker build -f hermes/Dockerfile -t agent-treasury-hermes .
#
# The shared CCTP parser lives at /shared so the browser app and this service
# parse the exact same message layout.

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY hermes/package.json hermes/package-lock.json ./
RUN npm ci

COPY shared ./shared
COPY hermes/tsconfig.json hermes/tsup.config.ts ./
COPY hermes/src ./src
COPY hermes/migrations ./migrations
COPY hermes/scripts ./scripts

RUN npm run build


FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY hermes/package.json hermes/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts

# Run as the image's non-root user. The service needs no persistent volume:
# business state lives in Postgres and Hermes state lives in /opt/data.
USER node

CMD ["node", "dist/mcp/server.js"]
