FROM node:22.23.1-alpine3.23 AS dependencies

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22.23.1-alpine3.23 AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
