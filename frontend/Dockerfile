# Stage 1: Build the React + Vite production application
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Accept VITE_API_BASE_URL build argument (defaults to /api)
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application assets from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
EXPOSE 3000
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
