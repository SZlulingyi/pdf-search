FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8787
CMD ["npm", "start"]
