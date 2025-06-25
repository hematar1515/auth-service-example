FROM node:18-alpine
WORKDIR /app
RUN npm install express axios express-session crypto
COPY . .
EXPOSE 3001
CMD ["node", "index.js"]