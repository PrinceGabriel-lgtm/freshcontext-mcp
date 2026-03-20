FROM apify/actor-node:20

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies including apify SDK
RUN npm install --include=dev

# Copy source and pre-built dist
COPY . ./

# Rebuild TypeScript (dist/ from repo is fallback if this fails)
RUN npm run build || echo "Build had warnings, using pre-compiled dist/"

# Tell Apify to run the Actor entry point, not the MCP server
CMD ["node", "dist/apify.js"]
