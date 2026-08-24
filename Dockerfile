FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# data/ and pdfs/ are recreated automatically by server.js if missing —
# in production these paths should be mounted as persistent volumes
# (see README "Deploying with Coolify" section), otherwise a redeploy
# wipes staff/client data and archived PDFs.
ENV PORT=3300
EXPOSE 3300

CMD ["node", "server.js"]
