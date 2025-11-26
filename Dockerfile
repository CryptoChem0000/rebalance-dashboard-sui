FROM node:20-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./

# Install dependencies WITHOUT running postinstall
RUN npm ci --ignore-scripts && npm cache clean --force

# Now copy all source files
COPY . .

RUN npm rebuild better-sqlite3

# Run postinstall manually after files are copied
RUN npm run postinstall

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

ENV IS_DOCKER_RUN=true

ENV WATCH_FREQUENCY=300

ENV CONFIG_FILE=./docker-files/config/config.json

ENTRYPOINT ["dumb-init", "--"]

CMD ["sh", "-c", "npm run start -- --watch ${WATCH_FREQUENCY} --no-log --config-file ${CONFIG_FILE}"]
