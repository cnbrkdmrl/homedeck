FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY config ./config
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
# Kullanicinin duzenledigi ekran yerlesimi burada durur (compose'ta named volume ile kalici)
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 8787
USER node
CMD ["node", "server/index.js"]
