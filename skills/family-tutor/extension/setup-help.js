const $=(selector)=>document.querySelector(selector);
const MCP_URL='https://family-tutor.qili2.com/mcp';

function setStatus(element,text,kind=''){
  element.textContent=text;
  element.className=`status ${kind}`.trim();
}

async function getSettings(){
  return chrome.runtime.sendMessage({type:'settings.get'});
}

async function renderKids(){
  const current=await getSettings();
  const kids=Array.isArray(current.children)?current.children:[];
  const list=$('#kids');
  list.replaceChildren();
  for(const kid of kids){
    const item=document.createElement('li');
    const linked=Boolean(current.bindings?.[kid.id]);
    item.textContent=`${kid.name||kid.id}: ${linked?'Linked':'Needs project'}`;
    if(linked)item.className='done';
    list.append(item);
  }
  return current;
}

async function copyAuthToken(){
  const result=await chrome.runtime.sendMessage({type:'chatgpt.authToken'});
  if(result?.error||!result?.authToken)throw new Error(result?.error||'Could not prepare the ChatGPT auth token.');
  await navigator.clipboard.writeText(result.authToken);
}

async function tryProjects(){
  const result=await chrome.runtime.sendMessage({type:'setup.projects'});
  if(result?.error)throw new Error(result.error);
  await renderKids();
  return result;
}

$('#developer').addEventListener('click',()=>chrome.runtime.sendMessage({type:'setup.openDeveloperMode'}));
$('#open-app').addEventListener('click',()=>chrome.runtime.sendMessage({type:'setup.openDeveloperMode'}));

$('#copy-url').addEventListener('click',async()=>{
  await navigator.clipboard.writeText(MCP_URL);
  setStatus($('#app-status'),'Server URL copied.','ok');
});

$('#copy-token').addEventListener('click',async()=>{
  try{
    await copyAuthToken();
    setStatus($('#app-status'),'Auth token copied. Paste it into ChatGPT if the setup screen asks for one.','ok');
  }catch(error){
    setStatus($('#app-status'),error.message,'error');
  }
});

$('#projects').addEventListener('click',async()=>{
  const button=$('#projects');
  button.disabled=true;
  setStatus($('#projects-status'),'Trying to create or link kid projects…');
  try{
    const result=await tryProjects();
    setStatus($('#projects-status'),`Linked ${result.linked||0} kid project${result.linked===1?'':'s'}.`,'ok');
  }catch(error){
    setStatus($('#projects-status'),`${error.message} You can finish this step manually in ChatGPT and then return here.`,'error');
  }finally{
    button.disabled=false;
  }
});

$('#refresh').addEventListener('click',async()=>{
  const current=await renderKids();
  const kids=Array.isArray(current.children)?current.children:[];
  const linked=kids.filter((kid)=>current.bindings?.[kid.id]).length;
  const connected=current.health?.state==='connected';
  setStatus(
    $('#finish-status'),
    connected&&linked===kids.length
      ? `Ready: connected and ${linked}/${kids.length} kids linked.`
      : `Connected: ${connected?'yes':'no'}. Kids linked: ${linked}/${kids.length}.`,
    connected&&linked===kids.length?'ok':'',
  );
});

$('#auto-setup').addEventListener('click',async()=>{
  const button=$('#auto-setup');
  button.disabled=true;
  setStatus($('#auto-status'),'Starting…');
  const completed=[];
  try{
    const projects=await tryProjects();
    completed.push(`${projects.linked||0} kid project(s) linked`);
  }catch(error){
    completed.push('kid projects need manual help');
  }
  try{
    await copyAuthToken();
    completed.push('auth token copied');
  }catch{
    completed.push('auth token not copied');
  }
  await chrome.runtime.sendMessage({type:'setup.openDeveloperMode'}).catch(()=>{});
  completed.push('ChatGPT setup opened');
  setStatus($('#auto-status'),`Auto setup finished what it could: ${completed.join('; ')}. Complete any ChatGPT confirmations, then use Check setup below.`,'ok');
  button.disabled=false;
});

await renderKids();
$('#refresh').click();
