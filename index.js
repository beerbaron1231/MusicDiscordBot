const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const sodium = require('libsodium-wrappers');
const playdl = require('play-dl');
const token = process.env.TOKEN;

const extractPlaylistID = (url) => {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('list');
    } catch (error) {
        return null;
    }
};

const extractMixID = (url) => {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('v');
    } catch (error) {
        return null;
    }
};

const getMixVideos = async (mixID) => {
    try {
        const mixInfo = await playdl.search(mixID, { source: { youtube: "video" } });
        return mixInfo.map(item => ({
            title: item.title,
            url: item.url
        }));
    } catch (error) {
        console.error('Error al obtener videos de la mezcla:', error);
        return [];
    }
};



(async () => {
    await sodium.ready; // Asegúrate de que sodium está listo antes de continuar

    const client = new Client({ 
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildVoiceStates, 
            GatewayIntentBits.GuildMessages, 
            GatewayIntentBits.MessageContent
        ]
    });

    let queue = [];
    let history = [];
    let currentConnection = null;
    let currentPlayer = createAudioPlayer();
    let isPlaying = false;

    client.once('ready', () => {
        console.log('¡El bot está en línea!');
    });

    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        
        const args = message.content.split(' ');
        const command = args.shift().toLowerCase();

        if (command === '!play') {
            if (message.member.voice.channel) {
                const query = args.join(' ');
                if (!query) {
                    message.reply('Por favor, proporciona una URL o el nombre de una canción.');
                    return;
                }

                const playlistID = extractPlaylistID(query);
                const mixID = extractMixID(query);

                if (playdl.yt_validate(query) === 'video') {
                    // Es una URL de un video
                    try {
                        const videoInfo = await playdl.video_basic_info(query);
                        queue.push(query);
                        message.reply(`Añadido a la cola: ${videoInfo.video_details.title}`);

                        // Verificar si la URL tiene una lista de reproducción asociada
                        if (playlistID && playdl.yt_validate(playlistID) === 'playlist') {
                            const playlist = await playdl.playlist_info(query);
                            playlist.videos.forEach(item => {
                                if (item.url !== query) {
                                    queue.push(item.url);
                                }
                            });
                            message.reply(`Añadidas canciones de la lista de reproducción: ${playlist.title}`);
                        } else if (mixID) {
                            const mix = await getMixVideos(mixID);
                            if (mix.length > 0) {
                                mix.forEach(item => queue.push(item.url));
                                message.reply(`Añadida la mezcla: ${mix[0].title}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error al obtener información del video:', error);
                        message.reply('Hubo un error al intentar obtener la información del video.');
                    }
                } else if (playlistID && playdl.yt_validate(playlistID) === 'playlist') {
                    // Es una lista de reproducción válida
                    const playlist = await playdl.playlist_info(query);
                    playlist.videos.forEach(item => queue.push(item.url));
                    message.reply(`Añadida la lista de reproducción: ${playlist.title}`);
                } else if (mixID) {
                    // Es una URL de mezcla válida
                    const mix = await getMixVideos(mixID);
                    if (mix.length > 0) {
                        mix.forEach(item => queue.push(item.url));
                        message.reply(`Añadida la mezcla: ${mix[0].title}`);
                    }
                } else {
                    // Es una palabra clave de búsqueda
                    try {
                        const searchResults = await playdl.search(query, { limit: 1 });
                        if (searchResults.length > 0) {
                            const url = searchResults[0].url;
                            queue.push(url);
                            message.reply(`Añadido a la cola: ${searchResults[0].title}`);
                        } else {
                            message.reply('No se encontraron resultados.');
                            return;
                        }
                    } catch (error) {
                        message.reply('Error al buscar la canción.');
                        console.error(error);
                        return;
                    }
                }

                if (!currentConnection) {
                    currentConnection = joinVoiceChannel({
                        channelId: message.member.voice.channel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    currentConnection.on(VoiceConnectionStatus.Ready, () => {
                        if (!isPlaying) {
                            playNext();
                        }
                    });
                } else if (!isPlaying) {
                    playNext();
                }
            } else {
                message.reply('¡Debes unirte a un canal de voz primero!');
            }
        } else if (command === '!pause') {
            if (currentPlayer) {
                currentPlayer.pause();
                message.reply('Reproducción pausada.');
            }
        } else if (command === '!resume') {
            if (currentPlayer) {
                currentPlayer.unpause();
                message.reply('Reproducción reanudada.');
            }
        } else if (command === '!stop') {
            if (currentConnection) {
                queue = [];
                history = [];
                currentPlayer.stop();
                currentConnection.destroy();
                currentConnection = null;
                isPlaying = false;
                message.reply('Reproducción detenida y conexión cerrada.');
            }
        } else if (command === '!skip') {
            if (currentPlayer) {
                message.reply('Canción saltada.');
                currentPlayer.stop(); // Esto activará AudioPlayerStatus.Idle y llamará a playNext()
            }
        }else if (command === '!queue') {
            if (queue.length > 0) {
                let response = 'Próximas canciones en la cola:\n';
                const nextSongs = queue.slice(0, 10);
                nextSongs.forEach((url, index) => {
                    response += `${index + 1}. ${url}\n`;
                });
                message.reply(response);
            } else {
                message.reply('La cola está vacía.');
            }
        } else if (command === '!back') {
            if (history.length > 0) {
                const previousUrl = history.pop();
                queue.unshift(previousUrl);
                message.reply('Reproduciendo la canción anterior.');
                currentPlayer.stop(); // Esto activará AudioPlayerStatus.Idle y llamará a playNext()
            } else {
                message.reply('No hay canciones anteriores en el historial.');
            }
        } else if (command === '!playlist') {
            const playlistUrl = args.join(' ');
            if (!playlistUrl) {
                message.reply('Por favor, proporciona una URL de una lista de reproducción.');
                return;
            }

            const playlistID = extractPlaylistID(playlistUrl);

            if (!playlistID || !await ytpl.validateID(playlistID)) {
                message.reply('URL de lista de reproducción no válida.');
                return;
            }

            try {
                const playlist = await ytpl(playlistID);
                let response = `Lista de reproducción: ${playlist.title}\n`;
                playlist.items.forEach((item, index) => {
                    response += `${index + 1}. ${item.title} - ${item.shortUrl}\n`;
                });
                message.reply(response);
            } catch (err) {
                console.error(err);
                message.reply('Hubo un error al obtener la lista de reproducción.');
            }
        }
    });

    const playNext = () => {
        if (queue.length === 0) {
            currentConnection.destroy();
            currentConnection = null;
            isPlaying = false;
            return;
        }

        const url = queue.shift();
        const stream = ytdl(url, { filter: 'audioonly' });
        const resource = createAudioResource(stream);

        currentPlayer = createAudioPlayer();
        currentPlayer.play(resource);
        currentConnection.subscribe(currentPlayer);

        isPlaying = true;

        currentPlayer.on(AudioPlayerStatus.Idle, () => {
            history.push(url); // Agregar la canción actual al historial cuando termine
            isPlaying = false;
            playNext();
        });

        currentPlayer.on('error', error => {
            console.error('Error:', error.message);
            isPlaying = false;
            playNext();
        });
    };

    client.login(token);
})();
