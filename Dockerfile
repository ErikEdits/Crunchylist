FROM node:20-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the app.
COPY . .

# Default internal port (override with the PORT env var if needed).
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/server.js"]
