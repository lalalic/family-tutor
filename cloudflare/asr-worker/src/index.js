const MAX_CLOCK_SKEW_SECONDS=120;

function decodeBase64Url(value){
  const padded=String(value||'').replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((String(value||'').length+3)%4);
  const raw=atob(padded);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function verifyRequest(request,body,env){
  const timestamp=request.headers.get('x-ft-timestamp')||'';
  const nonce=request.headers.get('x-ft-nonce')||'';
  const signature=request.headers.get('x-ft-signature')||'';
  const seconds=Number(timestamp);
  if(!Number.isFinite(seconds)||Math.abs(Date.now()/1000-seconds)>MAX_CLOCK_SKEW_SECONDS||nonce.length<16||!signature) return false;
  if(!env.PUBLIC_KEY_SPKI) return false;
  const spki=Uint8Array.from(atob(env.PUBLIC_KEY_SPKI),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('spki',spki,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const payload=new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}`);
  return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decodeBase64Url(signature),payload);
}

export default {
  async fetch(request,env){
    if(request.method!=='POST') return new Response('Not found',{status:404});
    const bodyText=await request.text();
    if(!(await verifyRequest(request,bodyText,env))) return new Response('Unauthorized',{status:401});
    const body=JSON.parse(bodyText||'null');
    if(!body?.audio) return Response.json({error:'audio_required'},{status:400});
    const result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{
      audio:body.audio,task:'transcribe',vad_filter:true,...(body.language?{language:body.language}:{}),
    });
    return Response.json({text:result?.text||''});
  },
};
