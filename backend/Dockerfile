FROM node:20-alpine

WORKDIR /app

# Copy package descriptors from backend directory
COPY backend/package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy backend source code
COPY backend/ .

# Expose Express server port
EXPOSE 5000

ENV NODE_ENV=production

# Start Express server
CMD ["node", "src/server.js"]

