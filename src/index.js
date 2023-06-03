const fs = require('fs');
const axios = require('axios');

const config = require('./config');
const username = config['lastfm-username'];
const apiKey = config['lastfm-api-key'];

let allTracks = [];
let allArtists = [];


async function fetchArtists(page = 1) {
    try {
        console.log('Fetching artists page', page);
        const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'user.gettopartists',
                user: username,
                api_key: apiKey,
                format: 'json',
                limit: 200,
                page: page,
            },
        });

        const data = response.data;
        const artists = data.topartists.artist;
        allArtists = allArtists.concat(artists);

        if (data.topartists['@attr'].totalPages > page) {
            fetchArtists(page + 1);
        } else {
            saveToFile(allArtists, 'user_artists.json');
        }
    } catch (error) {
        console.log('Error:', error.message);
    }
}

function saveToFile(data, fileName, append = false) {
    const fileContent = JSON.stringify(data, null, 2);

    if (append) {
        fs.appendFile(fileName, fileContent, (err) => {
            if (err) {
                console.error('Error appending to file:', err);
            } else {
                console.log('Data appended to', fileName);
            }
        });
    } else {
        fs.writeFile(fileName, fileContent, (err) => {
            if (err) {
                console.error('Error writing file:', err);
            } else {
                console.log('Data saved to', fileName);
            }
        });
    }
}


function cleanArtists() {
    const artists = require('./user_artists.json');
    // filter out artists with playcount below threshold
    let cleanedArtists = artists.map(artist => {
        if(artist.playcount <= config['musicman-playcount-threshold']) { return; }
        return {
            name: artist.name,
            playcount: artist.playcount,
            url: artist.url
        };
    });
    // remove undefined and null values
    cleanedArtists = cleanedArtists.filter(artist => artist);
    console.log(`Filtered out ${artists.length - cleanedArtists.length} artists with playcount below ${config['musicman-playcount-threshold']}. Total artists: ${cleanedArtists.length}`);
    saveToFile(cleanedArtists, 'user_artists_cleaned.json');
}

async function fetchSongs(artist, page = 1) {
    try {
        console.log(`Fetching songs for ${artist.name} (page ${page})`);
        const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'artist.gettoptracks',
                artist: artist.name,
                user: username,
                api_key: apiKey,
                format: 'json',
                limit: 200,
                page: page,
            },
        });

        const data = response.data;
        let tracks = data.toptracks.track;
        // filter out unnecessary data
        tracks = tracks.map(track => {
            return {
                name: track.name,
                artist: track.artist.name,
            };
        });
        allTracks = allTracks.concat(tracks);

        if (data.toptracks['@attr'].totalPages > page) {
            fetchSongs(artist, page + 1);
        } else {
            console.log(`Fetched ${tracks.length} songs for ${artist.name}`);
        }
    } catch (error) {
        console.log('Error:', error.message);
    }
}

async function fetchAllSongs() {
    const artists = require('./user_artists_cleaned.json');
    for (const artist of artists) {
        await fetchSongs(artist);
        saveToFile(allTracks, 'user_songs.json', true);
        allTracks = [];
    }
}



// fetchArtists();
// cleanArtists();
fetchAllSongs();