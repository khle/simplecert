FROM node:14
# Create app directory 
WORKDIR /usr/src/app
COPY package*.json ./  
RUN npm ci
COPY . .
CMD ["npm", "start"]
