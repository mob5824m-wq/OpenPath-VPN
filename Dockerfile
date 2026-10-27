FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/tsconfig.json ./
RUN npm install
COPY server/src ./src
RUN npm run build
EXPOSE 4433
CMD ["node","dist/index.js"]
