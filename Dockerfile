# ---- Build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "dist/index.cjs"]
