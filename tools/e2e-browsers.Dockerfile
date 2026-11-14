# Screens e2e on Safari (WebKit), Firefox, Chrome and Edge — the official Playwright image (Ubuntu 24.04, WebKit/Firefox
# included) plus branded Chrome + Edge. The Playwright version MUST match package.json (@playwright/test).
# Build: docker build -t pf-e2e-browsers:1.59.1 -f tools/e2e-browsers.Dockerfile tools
FROM mcr.microsoft.com/playwright:v1.59.1-noble
RUN npx -y playwright@1.59.1 install --with-deps chrome msedge && rm -rf /var/lib/apt/lists/*
