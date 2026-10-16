"use strict";
// The four saved source servers and nine authorized alert channels.
var DISCORD_SOURCES = {
  "1410547930250612828": {
    "name": "CCN",
    "channels": [
      "1424776504767680722",
      "1514248684575920160",
      "1460973469150875720",
      "1424776415286657136"
    ]
  },
  "1367457689386356766": {
    "name": "Rippin Packz",
    "channels": [
      "1491247646361391245"
    ]
  },
  "1182136115981996033": {
    "name": "Pokemon Restocks & News",
    "channels": [
      "1330775248613933159",
      "1219394012406878238",
      "1398394531484795011"
    ]
  },
  "1190757531988000930": {
    "name": "The Poke Gang",
    "channels": [
      "1343943991347118123"
    ]
  }
};
function discordSourceFor(guild,channel) { return DISCORD_SOURCES[guild]?.channels.includes(channel) ? DISCORD_SOURCES[guild] : null; }
if(typeof module!=="undefined")module.exports={DISCORD_SOURCES,discordSourceFor};
