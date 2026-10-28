FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY server/src ./src
RUN npm run build
EXPOSE 4433
CMD ["node","dist/index.js"]
