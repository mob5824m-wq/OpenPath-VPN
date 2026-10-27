FROM node:20-alpine
WORKDIR /app
COPY package.json vite.config.ts tsconfig.json index.html ./
RUN npm install
COPY src ./src
COPY public ./public
RUN npm run build
EXPOSE 5173 4173
CMD ["npm","run","preview"]
