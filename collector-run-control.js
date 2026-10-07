const {Pool}=require('pg');
const crypto=require('crypto');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
let ready;
function storage(){return ready ||= pool.query('CREATE TABLE IF NOT EXISTS collector_run_control (id INTEGER PRIMARY KEY, data JSONB NOT NULL)').catch(e=>{ready=null;throw e;});}
// A short renewable lease serializes browser collectors, including separate wakes.
async function run(action,input={}){
  await storage();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['authorized-browser-collector']);
    const state=(await client.query('SELECT data FROM collector_run_control WHERE id=1')).rows[0]?.data || {};
    const now=Date.now();if(Date.parse(state.expiresAt)<=now){delete state.runId;delete state.kind;delete state.expiresAt;state.manualWaiting=false;}
    let result;
    if(action==='begin'){
      if(!['source','manual'].includes(input.kind))throw Error('Choose source or manual collection');
      if(state.runId){if(input.kind==='manual' && state.kind==='source')state.manualWaiting=true;result={ok:true,acquired:false,busy:true,activeKind:state.kind,expiresAt:state.expiresAt};}
      else{state.runId=crypto.randomUUID();state.kind=input.kind;state.expiresAt=new Date(now+120000).toISOString();state.manualWaiting=false;state.pass=input.kind==='source' && now-Date.parse(state.fullCompletedAt || 0)>=300000?'full':'priority';if(input.kind==='source' && !state.fullCompletedAt)state.pass='full';result={ok:true,acquired:true,runId:state.runId,kind:state.kind,pass:state.pass,expiresAt:state.expiresAt};}
    }else{
      if(!state.runId || input.runId!==state.runId)throw Error('Collector lease expired or belongs to another run');
      if(action==='checkpoint'){state.expiresAt=new Date(now+120000).toISOString();result={ok:true,yieldToManual:state.kind==='source' && state.manualWaiting,expiresAt:state.expiresAt};}
      else if(action==='finish'){if(input.completed===true && state.kind==='source'){state.priorityCompletedAt=new Date(now).toISOString();if(state.pass==='full')state.fullCompletedAt=new Date(now).toISOString();}delete state.runId;delete state.kind;delete state.expiresAt;state.manualWaiting=false;result={ok:true,released:true,fullCompletedAt:state.fullCompletedAt || null};}
      else throw Error('Choose begin, checkpoint or finish');
    }
    await client.query('INSERT INTO collector_run_control(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[state]);await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={run};
