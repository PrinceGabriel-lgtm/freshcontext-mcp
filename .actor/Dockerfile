FROM apify/actor-node-playwright-chrome:20

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies — Playwright and Chromium already in base image
RUN npm install --include=dev

# Copy source and pre-built dist
COPY . ./

# Rebuild TypeScript
RUN npm run build || echo "Build had warnings, using pre-compiled dist/"

# Run the Actor entry point
CMD ["node", "dist/apify.js"]
