FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json vite.config.ts tsconfig.json index.html ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
RUN npm run build
EXPOSE 5173 4173
CMD ["npm","run","preview"]
