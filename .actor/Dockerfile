FROM apify/actor-node:18

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies including apify SDK
RUN npm install --include=dev

# Copy source and build
COPY . ./
RUN npm run build

# Tell Apify to run the Actor entry point, not the MCP server
CMD ["node", "dist/apify.js"]
