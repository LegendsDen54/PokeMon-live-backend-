'use strict';
require('dotenv').config();
const {commands}=require('../discord-commands');
async function main(){
  const {DISCORD_APPLICATION_ID:app,DISCORD_GUILD_ID:guild,DISCORD_BOT_TOKEN:token}=process.env;
  if(!/^\d+$/.test(app || '') || !/^\d+$/.test(guild || '') || !token)throw Error('Configure application ID, server ID and official app bot token securely first.');
  // Upsert only our named commands; never bulk-delete other installed commands.
  for(const command of commands){
    const response=await fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`,{
      method:'POST',redirect:'error',headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},
      body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Discord command registration failed (HTTP '+response.status+').');
  }
  console.log('Registered /monitor, /stock and /stockstatus in the configured server.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
