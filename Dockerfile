FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.mjs .
ENV PORT=10000 NODE_ENV=production
EXPOSE 10000
CMD ["node", "server.mjs"]
