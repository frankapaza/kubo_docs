FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
# `scripts/` hace falta porque `prebuild` comprueba que
# `src/api/attachment-rules.generated.ts` sigue coincidiendo con el dominio del
# backend. Aquí el contexto es solo `web/`, así que el backend no está: el
# script lo detecta y se salta la comprobación (`--skip-if-missing`), dando por
# bueno el fichero versionado. Lo que no puede pasar es que falte el script y
# `prebuild` falle por no encontrarlo.
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
