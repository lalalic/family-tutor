export async function reactToReceivedChildMessage(message,childId,{logger=console,emoji='🤔'}={}){
  try{
    await message.react(emoji);
    return true;
  }catch(error){
    logger.warn?.(`[family-tutor] ${childId} receive reaction failed`,error?.message||error);
    return false;
  }
}
