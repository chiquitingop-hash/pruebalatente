FROM node:20-alpine
WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

EXPOSE 5173

# `vite --host` (from package.json) binds to 0.0.0.0
CMD ["npm", "run", "dev"]
