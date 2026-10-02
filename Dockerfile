# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
# BuildKit cache mount: npm's download store survives layer-cache busts — the
# deploy pipeline's version-bump commit changes package.json on every run, so
# the layer itself can never cache. --prefer-offline serves packages from that
# store; audit/fund checks are dead weight in CI.
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund

COPY . .

ARG DIRECTUS_URL
ENV DIRECTUS_URL=$DIRECTUS_URL

ARG NUXT_PUBLIC_DIRECTUS_WEBSOCKET_URL
ENV NUXT_PUBLIC_DIRECTUS_WEBSOCKET_URL=$NUXT_PUBLIC_DIRECTUS_WEBSOCKET_URL

ARG NUXT_PUBLIC_SQUARE_APPLICATION_ID
ENV NUXT_PUBLIC_SQUARE_APPLICATION_ID=$NUXT_PUBLIC_SQUARE_APPLICATION_ID

ARG NUXT_PUBLIC_SQUARE_LOCATION_ID
ENV NUXT_PUBLIC_SQUARE_LOCATION_ID=$NUXT_PUBLIC_SQUARE_LOCATION_ID

ARG NUXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NUXT_PUBLIC_TURNSTILE_SITE_KEY=$NUXT_PUBLIC_TURNSTILE_SITE_KEY

ARG NUXT_PUBLIC_SERVICEMASTER_WS_URL
ENV NUXT_PUBLIC_SERVICEMASTER_WS_URL=$NUXT_PUBLIC_SERVICEMASTER_WS_URL

ARG NUXT_PUBLIC_SERVICEMASTER_TOKEN
ENV NUXT_PUBLIC_SERVICEMASTER_TOKEN=$NUXT_PUBLIC_SERVICEMASTER_TOKEN

# Where the Directus "reset your password" email points. Unset, Directus falls
# back to its own project_url — which is SupplyHub, not Connect.
ARG NUXT_PUBLIC_PASSWORD_RESET_URL
ENV NUXT_PUBLIC_PASSWORD_RESET_URL=$NUXT_PUBLIC_PASSWORD_RESET_URL

# Typecheck is deliberately NOT run here — pr-ci.yml gates every merge with it,
# and re-running it in the deploy build only slows the release of code that
# already passed. `nuxt build` runs its own prepare step.
RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/.output ./.output

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", ".output/server/index.mjs"]