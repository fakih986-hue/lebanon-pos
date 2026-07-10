FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
# nginx.conf.template gets ${PORT} substituted by the nginx image's envsubst entrypoint
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=80
EXPOSE 80
