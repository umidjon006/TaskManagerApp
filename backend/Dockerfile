FROM node:22-alpine

WORKDIR /app

# Avval faqat package fayllari — kod o'zgarsa ham kutubxonalar keshdan olinadi.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
