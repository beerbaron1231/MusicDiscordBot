# Usar la imagen oficial de Node.js como base
FROM node:18

# Instalar FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Crear y establecer el directorio de trabajo
WORKDIR /usr/src/app

# Copiar los archivos package.json y package-lock.json
COPY package*.json ./

# Instalar las dependencias del proyecto
RUN npm install

# Instalar libsodium-wrappers y youtube-search-api manualmente
RUN npm install libsodium-wrappers

# Copiar el resto de los archivos del proyecto
COPY . .

# Exponer el puerto (opcional, en caso de que tu bot use algún puerto)
EXPOSE 3000

# Comando para ejecutar el bot
CMD ["node", "index.js"]
