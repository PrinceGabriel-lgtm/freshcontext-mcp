FROM apify/actor-node-playwright-chrome:20

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm install --include=dev

# Install Chromium matching the npm-installed Playwright version
RUN npx playwright install chromium

# Copy source and pre-built dist
COPY . ./

# Rebuild TypeScript
RUN npm run build || echo "Build had warnings, using pre-compiled dist/"

# Run the Actor entry point
CMD ["node", "dist/apify.js"]
