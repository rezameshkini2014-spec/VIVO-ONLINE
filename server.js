const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = __dirname;
const API_ORIGIN = "https://vivo-messenger-2150agmf1-reza-personal.vercel.app";
const MIME = {".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon",".txt":"text/plain; charset=utf-8"};
function send(res,status,message){res.writeHead(status,{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"});res.end(message);}
async function proxyApi(req,res,url){
 if(!url.pathname.startsWith("/api/otp/"))return send(res,404,"Not found");
 const headers={"accept":req.headers.accept||"application/json"};
 if(req.headers["content-type"])headers["content-type"]=req.headers["content-type"];
 if(req.headers["x-api-key"])headers["x-api-key"]=req.headers["x-api-key"];
 let body;
 if(req.method!=="GET"&&req.method!=="HEAD"){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1048576)return send(res,413,"Request too large");chunks.push(chunk);}
  body=Buffer.concat(chunks);
 }
 try{
  const upstream=await fetch(new URL(url.pathname+url.search,API_ORIGIN),{method:req.method,headers,body,redirect:"manual"});
  const out={};for(const key of ["content-type","cache-control","retry-after"]){const value=upstream.headers.get(key);if(value)out[key]=value;}
  res.writeHead(upstream.status,out);
  if(req.method==="HEAD"||!upstream.body)return res.end();
  res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch(error){console.error("VIVO API proxy error:",error);res.writeHead(502,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify({ok:false,error:"ارتباط با سرویس احراز هویت برقرار نشد."}));}
}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname.startsWith("/api/"))return proxyApi(req,res,url);
 if(req.method!=="GET"&&req.method!=="HEAD")return send(res,405,"Method not allowed");
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return send(res,400,"Bad request");}
 if(pathname.includes("\\0")||pathname.split("/").includes(".."))return send(res,400,"Bad request");
 const relative=pathname==="/ "?"index.html":(pathname==="/"?"index.html":pathname.replace(/^\/+/,""));
 const file=path.resolve(ROOT,relative);
 if(!file.startsWith(ROOT+path.sep)&&file!==path.join(ROOT,"index.html"))return send(res,403,"Forbidden");
 fs.stat(file,(error,stat)=>{
  if(error||!stat.isFile())return send(res,404,"Not found");
  const headers={"content-type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream"};
  if(path.basename(file)==="sw.js"){headers["service-worker-allowed"]="/";headers["cache-control"]="no-cache";}
  else if(path.basename(file)==="index.html")headers["cache-control"]="no-cache";
  else headers["cache-control"]="public, max-age=300";
  res.writeHead(200,headers);if(req.method==="HEAD")return res.end();fs.createReadStream(file).pipe(res);
 });
}).listen(Number(process.env.PORT||3000),"0.0.0.0",()=>console.log("VIVO web service ready"));
