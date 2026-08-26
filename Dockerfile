FROM node:22-slim

# Install essential system utilities for Playwright
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    procps \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install application dependencies
RUN npm ci

# Install Playwright Chromium browser and its native system dependencies
RUN npx playwright install chromium --with-deps

# Copy application source code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]