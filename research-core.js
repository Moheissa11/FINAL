"use strict";
const { tokenize } = require("./assistant-core");

function splitIntoChunks(text, size=1100, overlap=180) {
  const clean=String(text||"").replace(/\r/g,"").trim();
  if(!clean) return [];
  const chunks=[];
  for(let start=0; start<clean.length; start+=size-overlap){
    const part=clean.slice(start,start+size).trim();
    if(part.length>60) chunks.push(part);
    if(start+size>=clean.length) break;
  }
  return chunks;
}

function retrieveRelevantPassages(question, documents, limit=6) {
  const query=tokenize(question);
  if(!query.length) return [];
  const uniqueQuery=[...new Set(query)];
  const candidates=[];
  for(const doc of documents||[]){
    for(const [index,chunk] of splitIntoChunks(doc.content).entries()){
      const terms=tokenize(chunk), counts=new Map();
      for(const term of terms) counts.set(term,(counts.get(term)||0)+1);
      let score=0;
      for(const term of uniqueQuery){
        const tf=counts.get(term)||0;
        if(tf) score+=(1+Math.log(tf))*(1+Math.log(1+query.filter(x=>x===term).length));
      }
      if(score>0) candidates.push({name:doc.name,source:doc.source||"saved source",chunk,score,index});
    }
  }
  return candidates.sort((a,b)=>b.score-a.score).slice(0,Math.max(1,limit));
}
module.exports={splitIntoChunks,retrieveRelevantPassages};
