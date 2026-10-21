# EnergyGuard dashboard. Built by docker-compose (service "frontend", port 3001 -> 80).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Compose passes /api/v1: the browser calls this nginx, which forwards to the backend (contract section 2).
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Lint and tests for Jenkins (ci.sh builds this stage only).
FROM build AS ci
RUN npm run lint && npm test

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
