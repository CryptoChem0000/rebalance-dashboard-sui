FROM node:20-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .

# Create logs and database directories
RUN mkdir -p /app/logs /app/database /app/reports

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

ENV IS_DOCKER_RUN=true

ENV WATCH_FREQUENCY=300

ENTRYPOINT ["dumb-init", "--"]

CMD ["sh", "-c", "npm run start -- --watch ${WATCH_FREQUENCY}"]
