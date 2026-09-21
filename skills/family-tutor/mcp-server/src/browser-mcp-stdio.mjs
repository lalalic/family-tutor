import fs from 'node:fs';
import path from 'node:path';

const bridgeUrl=process.env.FAMILY_TUTOR_BRIDGE_URL||'http://127.0.0.1:8787';
const token=process.env.FAMILY_TUTOR_BRIDGE_TOKEN?.trim()||readTokenFile(process.env.FAMILY_TUTOR_BRIDGE_TOKEN_FILE)||readRuntimeToken();
if(!token) throw new Error('FAMILY_TUTOR_BRIDGE_TOKEN, FAMILY_TUTOR_BRIDGE_TOKEN_FILE, FAMILY_TUTOR_INSTANCE_DIR, or FAMILY_TUTOR_CONFIG is required');


function readTokenFile(file){
  if(!file?.trim()) return '';
  try{return fs.readFileSync(file.trim(),'utf8').trim();}catch{return '';}
}

function readRuntimeToken(){
  let instance=process.env.FAMILY_TUTOR_INSTANCE_DIR?.trim();
  if(!instance&&process.env.FAMILY_TUTOR_CONFIG) instance=path.resolve(path.dirname(process.env.FAMILY_TUTOR_CONFIG),'..');
  if(!instance) return '';
  try{return fs.readFileSync(path.join(instance,'.browser-bridge','token'),'utf8').trim();}catch{return '';}
}

let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  input+=chunk;
  let newline;
  while((newline=input.indexOf('\n'))>=0){
    const line=input.slice(0,newline).trim(); input=input.slice(newline+1);
    if(!line) continue;
    let request;
    try{request=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'parse error'}});continue;}
    forward(request).catch(error=>write({jsonrpc:'2.0',id:request.id??null,error:{code:-32000,message:error.message}}));
  }
});

function write(value){process.stdout.write(`${JSON.stringify(value)}\n`);}

async function forward(request){
  const response=await fetch(`${bridgeUrl}/mcp`,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify(request),
    signal:AbortSignal.timeout(30000),
  });
  if(response.status===202) return;
  const body=await response.json();
  if(!response.ok) throw new Error(body.error||`bridge HTTP ${response.status}`);
  write(body);
}
