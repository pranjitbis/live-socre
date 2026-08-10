FROM node:22-alpine

# Install system dependencies for Playwright on Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    fontconfig \
    libstdc++ \
    glibc \
    libx11 \
    libxcomposite \
    libxdamage \
    libxext \
    libxfixes \
    libxrandr \
    libxrender \
    mesa-gl \
    mesa-dri-gles \
    gst-plugins-base \
    gst-plugins-good \
    gst-plugins-bad \
    gst-plugins-ugly \
    gstreamer \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with all deps for Playwright
RUN npm ci

# Copy application code
COPY . .

# Set environment variables for Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/lib/chromium
ENV PLAYWRIGHT_CHROME_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create a non-root user to run the app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["npm", "start"]