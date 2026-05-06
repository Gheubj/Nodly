FROM node:20-bookworm-slim

# Prisma schema engine requires OpenSSL; slim image omits it by default.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "start"]
