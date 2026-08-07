# Stage 0, "build-stage": 用 Bun 編譯 frontend
# 注意：build context 為專案根目錄（COPY 路徑以根目錄為準）
FROM oven/bun:1 AS build-stage

WORKDIR /app/frontend

COPY frontend/package.json frontend/bun.lock ./

RUN bun install

COPY ./frontend /app/frontend

ARG VITE_API_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG ENABLE_SIGNUP
ENV ENABLE_SIGNUP=${ENABLE_SIGNUP}

RUN bun run build


# Stage 1: 用 Nginx 提供編譯後的靜態檔
FROM nginx:1

COPY --from=build-stage /app/frontend/dist/ /usr/share/nginx/html

COPY ./frontend/nginx.conf /etc/nginx/conf.d/default.conf
