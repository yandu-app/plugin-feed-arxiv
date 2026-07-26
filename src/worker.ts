#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { SaxesParser } from 'saxes';
export type Entry = { id:string; title:string; abstractText:string; authors:string[]; publishedAt:string|null; sourceUrl:string; pdfUrl:string; sourceType:'arxiv'; externalIds:{kind:'arxiv';value:string}[] };
type Response={id:string;ok:true;result:{entries:Entry[];nextCursor:string|null}}|{id:string;ok:false;error:{code:string;message:string}};
const MAX=16*1024*1024, ID=/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/;
const ATOM='http://www.w3.org/2005/Atom', ARXIV='http://arxiv.org/schemas/atom', OPENSEARCH='http://a9.com/-/spec/opensearch/1.1/';
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
export function buildQueryUrl(query:string,start:number,limit:number){if(!Number.isInteger(start)||start<0)throw Error('cursor must be a non-negative integer');if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('limit must be between 1 and 50');return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=${start}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;}
export function parseAtom(xml:string):Entry[]{
 if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))throw Error('forbidden XML construct');
 const parser=new SaxesParser({xmlns:true}), entries:Entry[]=[];let entry:Record<string,unknown>|undefined,author='';
 const stack:{local:string;uri:string}[]=[];let seenRoot=false;let entryFields=new Set<string>(),authorHasName=false,pdfSeen=false;
 parser.on('doctype',()=>{throw Error('DTD is forbidden')});parser.on('cdata',()=>{throw Error('CDATA is forbidden')});
 parser.on('opentag',tag=>{
  const parent=stack.at(-1),grand=stack.at(-2),node={local:tag.local,uri:tag.uri};
  if(!parent){if(seenRoot||tag.uri!==ATOM||tag.local!=='feed')throw Error('expected one Atom feed root');seenRoot=true;}
  else if(tag.uri===ATOM){
   const feedChild=parent.uri===ATOM&&parent.local==='feed';const entryChild=parent.uri===ATOM&&parent.local==='entry';const authorChild=parent.uri===ATOM&&parent.local==='author'&&grand?.local==='entry';
   if(tag.local==='entry'){if(!feedChild||entry)throw Error('entry must be a direct feed child');entry={authors:[]};entryFields=new Set();pdfSeen=false;}
   else if(tag.local==='author'){if(!entryChild)throw Error('author must be a direct entry child');author='';authorHasName=false;}
   else if(tag.local==='name'){if(!authorChild||authorHasName)throw Error('name must occur once in an entry author');authorHasName=true;}
   else if(entry&&['id','title','summary','published','updated'].includes(tag.local)){if(!entryChild||entryFields.has(tag.local))throw Error(`${tag.local} must occur once as an entry child`);entryFields.add(tag.local);}
   else if(entry&&tag.local==='category'){if(!entryChild)throw Error('entry category must be a direct entry child');}
   else if(entry&&tag.local==='link'){if(!entryChild)throw Error('entry link must be a direct entry child');if(tag.attributes.title?.value==='pdf'){if(pdfSeen)throw Error('duplicate PDF link');pdfSeen=true;entry.pdfUrl=tag.attributes.href?.value;}}
   else if(entry)throw Error(`unexpected Atom element in entry: ${tag.local}`);
   else if(!feedChild)throw Error(`unexpected Atom placement: ${tag.local}`);
  }else if(tag.uri===ARXIV){if(!entry||parent?.uri!==ATOM||parent.local!=='entry'||!['comment','journal_ref','doi','primary_category'].includes(tag.local))throw Error('unexpected arXiv extension or placement');}
  else if(tag.uri===OPENSEARCH){if(entry||parent?.uri!==ATOM||parent.local!=='feed')throw Error('OpenSearch field must be a direct feed child');}
  else throw Error('unexpected XML namespace');
  stack.push(node);
 });
 parser.on('text',value=>{if(!entry)return;const node=stack.at(-1),parent=stack.at(-2);if(node?.uri!==ATOM)return;if(node.local==='name'&&parent?.local==='author')author+=value;else if(['id','title','summary','published','updated'].includes(node.local)&&parent?.local==='entry')entry[node.local]=String(entry[node.local]??'')+value;});
 parser.on('closetag',tag=>{if(entry&&tag.uri===ATOM&&tag.local==='author'){if(!authorHasName)throw Error('author requires one name');(entry.authors as string[]).push(clean(author));}if(entry&&tag.uri===ATOM&&tag.local==='entry'){const source=new URL(clean(String(entry.id??'')));if(!['https:','http:'].includes(source.protocol)||source.hostname!=='arxiv.org'||!source.pathname.startsWith('/abs/')||source.search||source.hash)throw Error('invalid arXiv source URL');const id=decodeURIComponent(source.pathname.slice(5));if(!ID.test(id))throw Error('invalid arXiv id');const sourceUrl=`https://arxiv.org/abs/${id}`,pdfUrl=String(entry.pdfUrl??'');if(pdfUrl!==`https://arxiv.org/pdf/${id}.pdf`)throw Error('invalid arXiv PDF URL');const title=clean(String(entry.title??'')),abstractText=clean(String(entry.summary??'')),authors=entry.authors as string[],publishedAt=clean(String(entry.published??''))||null;if(!title||!abstractText||!authors.length||!authors.every(Boolean))throw Error('incomplete Atom entry');if(publishedAt&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(publishedAt))throw Error('invalid publication time');entries.push({id,title,abstractText,authors,publishedAt,sourceUrl,pdfUrl,sourceType:'arxiv',externalIds:[{kind:'arxiv',value:id}]});entry=undefined;}stack.pop();});
 parser.write(xml).close();if(!seenRoot||stack.length)throw Error('incomplete Atom feed');return entries;
}
function validate(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('request must be an object');const r=value as Record<string,unknown>;if(Object.keys(r).some(k=>!['id','method','params'].includes(k))||typeof r.id!=='string'||!r.id||r.method!=='fetch'||!r.params||typeof r.params!=='object'||Array.isArray(r.params))throw Error('invalid request envelope');const p=r.params as Record<string,unknown>;if(Object.keys(p).some(k=>!['query','cursor','limit'].includes(k))||typeof p.query!=='string'||!p.query.trim())throw Error('invalid fetch params');const cursor=p.cursor??0,limit=p.limit??50;buildQueryUrl(p.query,cursor as number,limit as number);return{id:r.id,query:p.query,cursor:cursor as number,limit:limit as number};}
export async function handleRequest(value:unknown,get:(url:string)=>Promise<string>):Promise<Response>{let id='';try{const r=validate(value);id=r.id;const entries=parseAtom(await get(buildQueryUrl(r.query,r.cursor,r.limit)));if(entries.length>r.limit)throw Error('response contains too many entries');return{id,ok:true,result:{entries,nextCursor:entries.length===r.limit?String(r.cursor+entries.length):null}};}catch(error){return{id,ok:false,error:{code:id?'REQUEST_FAILED':'INVALID_REQUEST',message:error instanceof Error?error.message:String(error)}};}}
export async function readResponseBody(body:ReadableStream<Uint8Array>|null){if(!body)throw Error('arXiv response has no body');const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX)throw Error('arXiv response exceeds 16 MiB');chunks.push(value);}}finally{reader.releaseLock();}const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(all);}
async function main(){const lines=createInterface({input:process.stdin,crlfDelay:Infinity});for await(const line of lines){let response:Response;try{response=await handleRequest(JSON.parse(line),async url=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);try{const result=await fetch(url,{headers:{'user-agent':'Yandu/1.0 (feed-arxiv)'},signal:controller.signal});if(!result.ok)throw Error(`arXiv API returned ${result.status}`);return await readResponseBody(result.body);}finally{clearTimeout(timeout);}});}catch(error){response={id:'',ok:false,error:{code:'INVALID_JSON',message:error instanceof Error?error.message:String(error)}};}process.stdout.write(`${JSON.stringify(response)}\n`);}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main();
