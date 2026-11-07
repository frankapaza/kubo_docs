FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Paquete del appender (zip, manifest y manuales) que el panel ofrece a los
# administradores. Va antes del chown para que `app` pueda leerlo. El
# .dockerignore excluye `*.md` solo en la raiz del contexto, asi que los
# manuales de assets/ si entran.
COPY assets ./assets
RUN mkdir -p uploads && addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
