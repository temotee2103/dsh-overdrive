# syntax=docker/dockerfile:1
# 单镜像双命令：dsh（web profile + 插件）与 gateway 共用同一构建产物。
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY cordis.smoke.yml ./cordis.smoke.yml
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3080 3190
# 默认启动 gateway；compose 里 dsh 服务覆盖 command。
CMD ["node", "packages/gateway/dist/index.js"]
