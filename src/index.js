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
                // console.log('Data appended to', fileName);
            }
        });
    } else {
        fs.writeFile(fileName, fileContent, (err) => {
            if (err) {
                console.error('Error writing file:', err);
            } else {
                // console.log('Data saved to', fileName);
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
            url: artist.url,
            mbid: artist.mbid,
        };
    });
    // remove undefined and null values
    cleanedArtists = cleanedArtists.filter(artist => artist);
    console.log(`Filtered out ${artists.length - cleanedArtists.length} artists with playcount below ${config['musicman-playcount-threshold']}. Total artists: ${cleanedArtists.length}`);
    // only add new artists to json file
    const existingArtists = require('./user_artists_cleaned.json');
    cleanedArtists = cleanedArtists.filter(artist => !existingArtists.find(a => a.name === artist.name));
    console.log(`Filtered out ${cleanedArtists.length} artists that already exist in user_artists_cleaned.json`);
    // add new artists to json file
    existingArtists.concat(cleanedArtists);

    saveToFile(existingArtists, 'user_artists_cleaned.json');
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

// to increase the likelihood of finding mbid, we need to find the artists most popular song on lastfm and then use that song to find the correct mbid
async function fetchTopSongsLastFM(lastfmArtist, amount = 100) {
    // https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=The%20Beatles&api_key=YOUR_API_KEY&format=json&limit=5
    try {
        // console.log(`Fetching top songs for ${lastfmArtist}`);
        // url encode artist name
        const encodedArtist = encodeURIComponent(lastfmArtist);
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodedArtist}&api_key=${apiKey}&format=json&limit=${amount}`);
        const data = response.data;
        let tracks = data.toptracks.track;
        tracks = tracks.map(track => {
            return {
                name: track.name,
            };
        });
        // console.log(tracks);
        return tracks;
    }
    catch (error) {
        console.log('Error:', error.message);
        return [];
    }
}

async function fetchTopSongsMusicBrainz(mbid, amount = 100) {
    // https://musicbrainz.org/ws/2/work?artist=52aa4dd5-4a18-43b1-8bfb-7cf3681be43f&limit=5
    try {
        console.log(`Fetching top songs for ${mbid}`);
        // sleep to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        const response = await axios.get(`https://musicbrainz.org/ws/2/release?artist=${mbid}&limit=${amount}`, {
            headers: {
                'User-Agent': config['musicbrainz-agent'],
            },
        });
        const data = response.data;
        let tracks = data.releases;
        tracks = tracks.map(track => {
            return {
                name: track.title,
            };
        });
        // console.log(tracks);
        return tracks;
    }
    catch (error) {
        console.log('Error:', error.message);
        return [];
    }
}

// if an artist does not have mbid, fetch it from musicbrainz
async function fetchArtistMbid(artist) {
    // https://musicbrainz.org/ws/2/artist?query=Rootkit
    try {
        console.log(`Fetching mbid for ${artist}`);
        const response = await axios.get(`https://musicbrainz.org/ws/2/artist?query=${artist}`, {
            headers: {
                'User-Agent': config['musicbrainz-agent'],
            },
        });

        const data = response.data;
        // if there are multiple results, we need to find the correct one using the top songs
        if(data.count > 1){
            console.log(`Found ${data.count} results for ${artist}`);
            const topSongs = await fetchTopSongsLastFM(artist);
            // if at least two of the top songs from lastfm match the songs from musicbrainz, we can assume that we have found the correct artist
            for(let artist of data.artists){
                const topSongsMusicBrainz = await fetchTopSongsMusicBrainz(artist.id);
                let matches = 0;
                for(let song of topSongs){
                    if(topSongsMusicBrainz.find(s => s.name === song.name)){
                        matches++;
                    }
                }
                if(matches >= 1){
                    console.log(`Found mbid for ${artist.name}: ${artist.id}`);
                    return artist.id;
                }
            }
            console.log(`No mbid found for ${artist}`);
            return null;
        }
        else if(data.count === 1){
            console.log(`Found mbid for ${artist}: ${data.artists[0].id}`);
            return data.artists[0].id;
        }
        else{
            console.log(`No mbid found for ${artist}`);
            return null;
        }
    } catch (error) {
        console.log('Error:', error.message);
    }
}

// musicbrainz fetch artist data from mbid, if we dont have mbid, fetch from artist name
async function fetchArtistLinks(mbid, name){
    try {
        console.log(`Fetching artist data for ${name}`);
        const response = await axios.get(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels`, {
            headers: {
                'User-Agent': config['musicbrainz-agent'],
            },
        });

        const data = response.data;
        let links = []
        // check if artist has any links
        if(data.relations){   
            for(let link of data.relations){
                links.push(link.url.resource);
            }
        }
        console.log(links);
        return links;
    } catch (error) {
        console.log('Error:', error.message);
    }
}

// add mbid to artists that dont have it
async function addMbidToArtists(){
    const artists = require('./user_artists_cleaned.json');
    let missingCount = 0;
    for(let artist of artists){
        if(!artist.mbid || artist.mbid === null || artist.mbid === ''){
            missingCount++;
        }
    }
    console.log(`Found ${missingCount} artists without mbid`);

    for(let artist of artists){
        // if artist doesnt have mbid, or mbid is null, or mbid is empty string, fetch it
        if(!artist.mbid || artist.mbid === null || artist.mbid === ''){
            const mbid = await fetchArtistMbid(artist.name);
            artist.mbid = mbid;
            saveToFile(artists, 'user_artists_cleaned.json');
        }
    }
}

// find the deezer link for each artist
async function addDeezerLinkToArtists(){
    const artists = require('./user_artists_cleaned.json');
    for(let artist of artists){
        if((!artist.deezer_link || artist.deezer_link === null) && (artist.mbid !== null && artist.mbid !== '' && artist.deezer_link != '')){
            const links = await fetchArtistLinks(artist.mbid, artist.name);
            if(links.length === 0){
                console.log(`No links found for ${artist.name}`);
                artist.deezer_link = '';
                saveToFile(artists, 'user_artists_cleaned.json');
                continue;
            }
            artist.deezer_link = links.find(link => link.includes('deezer'));
            if(!artist.deezer_link){
                artist.deezer_link = '';
            }
            saveToFile(artists, 'user_artists_cleaned.json');
            // sleep to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

function createDeemonCommand(ids = true){
    const artists = require('./user_artists_cleaned.json');
    if(ids){
        let command = 'deemon monitor --artist-id ';
        for(let artist of artists){
            if(artist.deezer_link){
                let id = artist.deezer_link.split('/').pop();
                command += id + ', --artist-id ';
            }
        }
        console.log(command);
    }else{
        let command = 'deemon monitor ';
        let weirdNames = [];
        for(let artist of artists){
            if(artist.deezer_link == '' || artist.deezer_link == null || artist.deezer_link == undefined){
                let name = artist.name;
                name = `"${name}"`
                // check if name contains any non-ascii characters
                if(name.match(/[^\x00-\x7F]/g)){
                    weirdNames.push(name);
                    continue;
                }
                // if name contains any () or [] or - or , or . or ' or " or / or \ or : or ; or ! or ? or & or * or # or @ or % or $ or ^ or ~ or ` or | or = or + or < or > or _ or { or }
                if(name.match(/[\(\)\[\]\-\,\.\'\/\\\:\;\!\?\&\*\#\@\%\$\^\~\`\|\=\+\<\>\_\{\}]/g)){
                    weirdNames.push(name);
                    continue;
                }
                command += name + ', ';
            }
        }
        console.log(command);
        console.log(weirdNames);
    }
}

createDeemonCommand(false);

// addMbidToArtists()

// addDeezerLinkToArtists()


// fetchArtistLinks('52aa4dd5-4a18-43b1-8bfb-7cf3681be43f', 'fij');

// fetchArtists();
// cleanArtists();
// fetchAllSongs();