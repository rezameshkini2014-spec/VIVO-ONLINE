const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const publicFiles = new Set([
  "/vivo-v2.html",
  "/vivo-v2.js",
  "/vivo-v2.css",
  "/vivo-v2-auth.css",
  "/vivo-v2-social.css",
  "/vivo-v2-chat.css",
  "/manifest.webmanifest",
  "/sw.js"
]);
const mime = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json",".svg":"image/svg+xml",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".webp":"image/webp",".ico":"image/x-icon",".woff2":"font/woff2",
  ".mp4":"video/mp4",".webm":"video/webm"
};

function responseAdapter(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { if (!res.headersSent) res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(data)); return res; };
  res.send = data => { res.end(data); return res; };
  return res;
}
async function readBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("درخواست بیش از اندازه بزرگ است.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw=Buffer.concat(chunks).toString("utf8");
  if ((req.headers["content-type"]||"").includes("application/json")) {
    try { return JSON.parse(raw); } catch { throw new Error("ساختار JSON معتبر نیست."); }
  }
  return raw;
}
async function api(req,res,url) {
  const pathname=url.pathname;
  let handler, query={};
  if (pathname === "/api/vivo/session") handler=require("./api/vivo/session.js");
  else if (pathname === "/api/vivo/logout") handler=require("./api/vivo/logout.js");
  else if (pathname.startsWith("/api/otp/")) {
    const endpoint=pathname.slice("/api/otp/".length);
    if (!["config","send","subscribe","verify"].includes(endpoint)) return responseAdapter(res).status(404).json({ok:false,error:"مسیر API پیدا نشد."});
    handler=require("./api/otp/"+endpoint+".js");
  }
  else if (pathname.startsWith("/api/vivo/")) {
    const parts=pathname.slice("/api/vivo/".length).split("/").filter(Boolean);
    if (!parts.length || parts.some(x=>x===".."||x===".")) return responseAdapter(res).status(404).json({ok:false,error:"مسیر پیدا نشد."});
    handler=require("./api/vivo/[...path].js");
    query.path=parts;
  } else return responseAdapter(res).status(404).json({ok:false,error:"مسیر API پیدا نشد."});
  const parsed=new URLSearchParams(url.search);
  for (const [key,value] of parsed) query[key]=value;
  req.query=query;
  req.body=await readBody(req);
  return handler(req,responseAdapter(res));
}
function staticFile(req,res,url) {
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); }
  catch { res.writeHead(400,{"Content-Type":"text/plain; charset=utf-8"}); return res.end("Bad request"); }
  if (pathname === "/") pathname="/vivo-v2.html";
  if (!publicFiles.has(pathname)) {
    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});
    return res.end("Not found");
  }
  const file=path.join(root,pathname.slice(1));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});
    return res.end("Not found");
  }
  const ext=path.extname(file).toLowerCase();
  res.writeHead(200,{
    "Content-Type":mime[ext]||"application/octet-stream",
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"SAMEORIGIN",
    "Referrer-Policy":"strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy":"same-origin",
    "Cache-Control":ext===".html"?"no-cache":"public, max-age=3600"
  });
  if (req.method==="HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!["GET","POST"].includes(req.method)) return responseAdapter(res).status(405).json({ok:false,error:"Method not allowed"});
      await api(req,res,url);
    } else if (req.method==="GET" || req.method==="HEAD") {
      staticFile(req,res,url);
    } else {res.writeHead(405);res.end("Method not allowed");}
  } catch(error) {
    console.error("VIVO request error:",error);
    if(!res.headersSent) responseAdapter(res).status(error.message.includes("بزرگ")?413:400).json({ok:false,error:error.message||"خطای داخلی سرور"});
    else res.destroy();
  }
});
const port=Number(process.env.PORT||3000);
server.listen(port,"0.0.0.0",()=>console.log("VIVO Render server listening on "+port));
