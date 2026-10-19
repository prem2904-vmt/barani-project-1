# Builds the website ONCE (production configuration). Settings are not baked per
# environment: the site reads /config.json from the server it is served on.
# The final image only carries the static files in /site; release.yml copies
# them out onto the server.
FROM node:22 AS build
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1 NODE_OPTIONS=--max-old-space-size=4096 HOME=/tmp
WORKDIR /w
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts=false
COPY . .
RUN npm run build && test -f public/index.html

FROM busybox:1.36
COPY --from=build /w/public /site
