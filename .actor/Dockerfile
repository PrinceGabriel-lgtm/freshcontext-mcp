FROM apify/actor-node:20

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies including apify SDK
RUN npm install --include=dev

# Install Playwright's Chromium browser — required for:
# extract_hackernews, extract_reddit, extract_yc, extract_producthunt, extract_scholar
RUN npx playwright install chromium --with-deps

# Copy source and pre-built dist
COPY . ./

# Rebuild TypeScript
RUN npm run build || echo "Build had warnings, using pre-compiled dist/"

# Run the Actor entry point
CMD ["node", "dist/apify.js"]
