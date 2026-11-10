/**
 * EARTIFY — lightweight Node server.
 * NOTES FOR HANDOFF:
 * 1) The browser talks only to /api/* routes; secrets stay in this file/.env.
 * 2) AI mode is optional. Without OPENAI_API_KEY, the app returns a clearly
 *    labelled starter analysis so the UI remains demoable.
 * 3) Research links are primary-source starting points, not a substitute for
 *    checking the exact evidence behind a mission decision.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const { extractUpload } = require("./document-extract");
const { retrieveHybridPassages } = require("./embedding-core");
const { detectLanguage, classifyIntent, classifyTeachingMode } = require("./assistant-core");
const { retrieveRelevantPassages, splitIntoChunks } = require("./research-core");
const embeddingCache = new Map();
const requestBuckets = new Map();

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = process.env.PORT || 3000;
const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon"
};

// Minimal .env loader so no package install is needed.
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  envFile.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch (_) {}


// Small persistent starter database: capped at 20 accounts. Passwords are salted
// scrypt hashes; sessions and each user's documents/history are stored server-side.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (process.env.VERCEL ? "/tmp/eartify-data" : path.join(ROOT, "data"));
const DB_FILE = path.join(DATA_DIR, "eartify-db.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadDB(){
  try {
    const value = JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
    return {users:[],sessions:{},documents:[],history:[],conversations:[],...value};
  } catch { return {users:[],sessions:{},documents:[],history:[],conversations:[]}; }
}
let db = loadDB();
function saveDB(){ const tmp=DB_FILE+".tmp"; fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600}); fs.renameSync(tmp,DB_FILE); }
function cookieToken(req){ const m=String(req.headers.cookie||"").match(/(?:^|;\s*)eartify_session=([a-f0-9]+)/); return m?.[1]||""; }
function currentUser(req){ const id=db.sessions[cookieToken(req)]; return db.users.find(u=>u.id===id)||null; }
function authCookie(res,token){ const secure=process.env.NODE_ENV === "production" ? "; Secure" : ""; res.setHeader("Set-Cookie",`eartify_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`); }
function publicUser(u){ return {id:u.id,email:u.email,name:u.name}; }
function extractTextFromUpload(input){ return extractUpload(input); }

const SOURCES = [
  { name:"NASA Solar System Exploration", url:"https://science.nasa.gov/solar-system/", note:"Planetary facts and mission context" },
  { name:"NASA Planetary Data System", url:"https://pds.nasa.gov/", note:"Archived planetary mission datasets" },
  { name:"NASA Image and Video Library", url:"https://images.nasa.gov/", note:"Searchable NASA imagery and media" },
  { name:"NASA Moon", url:"https://science.nasa.gov/moon/", note:"Lunar environment and exploration" },
  { name:"NASA Mars", url:"https://science.nasa.gov/mars/", note:"Martian environment and exploration" },
  { name:"NASA Human Research Program", url:"https://www.nasa.gov/hrp/", note:"Human-spaceflight risks and countermeasures" }
];

function send(res, status, data, type="application/json; charset=utf-8") {
  res.writeHead(status, {"Content-Type":type, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"same-origin"});
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 12 * 1024 * 1024) reject(new Error("Request too large (maximum 12 MB).")); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch(e) { reject(e); } });
    req.on("error", reject);
  });
}
function fallbackAnalysis(input) {
  const place = input.place || "the selected destination";
  const terrain = input.terrain || "unknown terrain";
  const hazards = input.hazards || "not specified";
  return {
    mode:"starter",
    title:`Mission concept for ${place}`,
    summary:`This is a preliminary concept based on the information entered for ${place}. Validate local measurements, landing constraints, and radiation/weather data before treating any recommendation as mission-ready.`,
    comparison:[
      {label:"Environment", value:`${terrain}; ${hazards}`},
      {label:"Power", value:"Compare sunlight hours, dust/shadow exposure, and storage needs."},
      {label:"Mobility", value:"Match wheel/leg design to slope, rocks, loose regolith, and travel distance."},
      {label:"Communications", value:"Check line-of-sight, relay coverage, and expected data delay."}
    ],
    risks:[
      {level:"High",name:"Unknowns in local conditions",detail:"The submitted location description is not a verified environmental dataset."},
      {level:"Medium",name:"Power and thermal management",detail:"Dust, darkness, extreme temperature swings, or limited sunlight can constrain operations."},
      {level:"Medium",name:"Mobility and mechanical wear",detail:"Loose soil, sharp rocks, slopes, and dust can reduce traction and damage moving parts."}
    ],
    solutions:[
      "Deploy a small scout first to map slopes, obstacles, illumination, and communication visibility.",
      "Use a modular, dust-tolerant rover with replaceable wheel/traction components and a protected electronics bay.",
      "Combine solar generation with rechargeable storage; size the system only after measuring the local light cycle.",
      "Use thermal insulation, heaters, and temperature monitoring selected for the actual destination range."
    ],
    robot:{
      name:"ORBIT Scout",
      purpose:"A modular reconnaissance rover for terrain mapping and environmental sampling.",
      design:"Six-wheel rocker-bogie chassis, stereo cameras, navigation sensors, a compact spectrometer, and a swappable science payload.",
      autonomy:"Obstacle detection, route planning within a human-approved safe zone, health monitoring, and store-and-forward communications.",
      limitation:"Concept only. Payload, mass, power, thermal design, and autonomy must be engineered and tested for the target."
    },
    researchQueries:[
      `${place} surface conditions NASA`,
      `${place} radiation environment NASA`,
      `${place} terrain and landing site data NASA`
    ],
    sources:SOURCES,
    disclaimer:"Starter analysis — no live AI research was performed. Add an AI provider key and verify all findings against primary mission data."
  };
}
async function aiAnalysis(input) {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis(input);
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = `You are a cautious planetary mission research assistant for a student prototype.
Analyze this user-supplied destination. Do not invent measurements or claim a source was checked if it was not.
Clearly distinguish known facts, assumptions, and unknowns. Prefer NASA/PDS primary sources.
Return ONLY valid JSON with keys: title, summary, comparison (array of {label,value}), risks (array of {level,name,detail}), solutions (array of strings), robot ({name,purpose,design,autonomy,limitation}), researchQueries (array of search phrases), sources (array of {name,url,note}), disclaimer.
Destination: ${JSON.stringify(input)}
Use these research starting points where relevant: ${JSON.stringify(SOURCES)}
If no precise coordinates or dataset are supplied, say so and make recommendations conditional.`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,temperature:0.35,response_format:{type:"json_object"},messages:[
      {role:"system",content:"Return careful, evidence-aware mission analysis as JSON only."},
      {role:"user",content:prompt}
    ]}),signal:AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}

const OFFLINE_SPACE_REFERENCE = [
  { names:["mars","المريخ"], title:"Mars", extract:"Mars is a cold, rocky planet with a thin atmosphere made mostly of carbon dioxide. Ancient river channels and minerals indicate that liquid water existed on its surface in the past.", url:"https://science.nasa.gov/mars/" },
  { names:["moon","the moon","القمر"], title:"Moon", extract:"Earth’s Moon is a rocky natural satellite with almost no atmosphere. Its surface experiences extreme day-night temperature changes, and permanently shadowed polar regions may preserve water ice.", url:"https://science.nasa.gov/moon/" },
  { names:["earth","الأرض"], title:"Earth", extract:"Earth is a rocky planet with stable liquid water on its surface and an atmosphere rich in nitrogen and oxygen. It is the only world currently known to support life.", url:"https://science.nasa.gov/earth/" },
  { names:["jupiter","المشتري"], title:"Jupiter", extract:"Jupiter is the largest planet in the Solar System. It is a gas giant with a powerful magnetic field, numerous moons, and the Great Red Spot.", url:"https://science.nasa.gov/jupiter/" },
  { names:["saturn","زحل"], title:"Saturn", extract:"Saturn is a gas giant known for its extensive ring system. Its moons include Titan and Enceladus, both important targets for planetary science.", url:"https://science.nasa.gov/saturn/" },
  { names:["venus","الزهرة"], title:"Venus", extract:"Venus is a rocky planet with a dense carbon-dioxide atmosphere and an extremely hot surface. Its clouds contain sulfuric-acid droplets.", url:"https://science.nasa.gov/venus/" },
  { names:["mercury","عطارد"], title:"Mercury", extract:"Mercury is the smallest planet and the closest to the Sun. It has a heavily cratered surface and large temperature swings.", url:"https://science.nasa.gov/mercury/" },
  { names:["sun","الشمس"], title:"Sun", extract:"The Sun is the star at the center of our Solar System. Its energy is produced by nuclear fusion in its core.", url:"https://science.nasa.gov/sun/" },
  { names:["pluto","بلوتو"], title:"Pluto", extract:"Pluto is a dwarf planet in the Kuiper Belt. It has mountains, glaciers, a thin atmosphere, and several moons.", url:"https://science.nasa.gov/dwarf-planets/pluto/" }
];
function offlineSpaceLookup(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const match = OFFLINE_SPACE_REFERENCE.find(item => item.names.includes(normalized));
  const textures = {moon:"/assets/moon-closeup.png",earth:"/assets/earth-night.png",saturn:"/assets/saturn-reference.png"};
  return match ? {query, title:match.title, found:true, extract:match.extract, description:"Offline reference · NASA topic page", thumbnail:textures[normalized] || "", url:match.url, offline:true} : null;
}

async function encyclopediaLookup(query) {
  const clean = String(query || "").trim();
  if (!clean) throw new Error("Enter something to search for.");
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("list", "search");
  endpoint.searchParams.set("srsearch", clean);
  endpoint.searchParams.set("srlimit", "1");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  let search;
  try { search = await fetch(endpoint, { headers: { "User-Agent": "EARTIFY-Student-Research/1.1 (educational prototype)" }, signal: AbortSignal.timeout(12000) }); }
  catch (error) { const offline = offlineSpaceLookup(clean); if (offline) return offline; throw new Error("Live search could not connect. Check the server internet connection and try again. Known planets and moons can still be searched offline."); }
  if (!search.ok) throw new Error(`Search provider returned ${search.status}. Try again in a moment.`);
  const found = await search.json();
  const page = found?.query?.search?.[0];
  if (!page) return { query: clean, found: false, title: clean, extract: "No matching result was found. Try a more specific spelling or search term.", url: "https://en.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(clean), thumbnail: "" };
  const details = new URL("https://en.wikipedia.org/w/api.php");
  details.searchParams.set("action", "query"); details.searchParams.set("prop", "extracts|pageimages|info");
  details.searchParams.set("exintro", "1"); details.searchParams.set("explaintext", "1");
  details.searchParams.set("pithumbsize", "900"); details.searchParams.set("inprop", "url");
  details.searchParams.set("titles", page.title); details.searchParams.set("format", "json"); details.searchParams.set("origin", "*");
  let detailResponse;
  try { detailResponse = await fetch(details, { headers: { "User-Agent": "EARTIFY-Student-Research/1.1 (educational prototype)" }, signal: AbortSignal.timeout(12000) }); }
  catch (error) { const offline = offlineSpaceLookup(clean); if (offline) return offline; throw new Error("Search found a result, but its details could not be loaded. Please retry."); }
  if (!detailResponse.ok) throw new Error(`Could not load the result details (${detailResponse.status}).`);
  const detailJson = await detailResponse.json();
  const record = Object.values(detailJson?.query?.pages || {})[0] || {};
  return { query: clean, title: record.title || page.title, found: true, extract: record.extract || page.snippet?.replace(/<[^>]*>/g, "") || "No summary is available for this result.", description: "Reference result", thumbnail: record.thumbnail?.source || "", url: record.fullurl || "https://en.wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")) };
}

function looksLikeUnclearInput(message) {
  const text = String(message || '').trim();
  if (!text) return true;
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return true;
  const letters = (text.match(/[a-z\u0600-\u06FF]/gi) || []).length;
  if (letters < 2) return true;
  // Keep short real words (hi, ok, no, yes) valid. Flag only obvious keyboard noise.
  if (/^(.)\1{3,}$/iu.test(text)) return true;
  if (/^[asdfghjklqwertyuiopzxcvbnm]{5,}$/i.test(text) && !/[aeiou]/i.test(text)) return true;
  return false;
}

function messageLanguage(message) {
  return detectLanguage(message);
}
function robotReply(message) {
  const q = String(message || '').toLowerCase();
  const ar = messageLanguage(message) === "ar";
  const raw = String(message || '').trim();
  const englishName = raw.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z][A-Za-z'-]{1,24})\b/i);
  const arabicName = raw.match(/(?:اسمي|انا اسمي|أنا اسمي)\s+([\u0621-\u064A]{2,20})/);
  const introducedName = englishName?.[1] || arabicName?.[1];
  if (introducedName) return ar
    ? `تشرفت بيك يا ${introducedName}! 😊 نورت EARTIFY. أنا Cero، صاحبك في رحلة استكشاف الفضاء. تحب نبدأ بأي كوكب أو قمر؟`
    : `Nice to meet you, ${introducedName}! 😊 Welcome to EARTIFY. I’m Cero, your space buddy. Which planet or moon should we explore first?`;
  if (looksLikeUnclearInput(message)) return ar
    ? 'معلش يا مستكشف، مش قادر أفهم الرسالة دي. ممكن توضح قصدك أو تعيد كتابة السؤال؟ 🤖'
    : "Sorry, explorer — I’m not sure what you mean. Could you rephrase your message or clarify your question? 🤖";
  if (/^(hi|hello|hey|مرحبا|اهلا|أهلا|ازيك|السلام عليكم)[!.؟ ]*$/i.test(q)) return ar
    ? 'أهلًا بيك يا مستكشف! 🚀 أنا Cero. اسألني عن الكواكب والأقمار والفضاء والبعثات، وهحاول أجاوبك بدقة وأوضح مصدر المعلومة.'
    : "Hi, explorer! 🚀 I’m Cero. Ask me about planets, moons, space, or missions, and I’ll do my best to give you a clear, accurate answer with sources.";
  if (/^(how are you|how are u|what's up|whats up|ازيك|إزيك|عامل ايه|عامل إيه|اخبارك|أخبارك)[؟?! .]*$/i.test(q)) return ar
    ? 'الحمد لله، تمام! 😊 إنت أخبارك إيه؟ تحب نستكشف حاجة جديدة؟'
    : "I'm doing well, thanks! 😊 How are you? Want to explore something new?";
  if (/^(good morning|good evening|good afternoon|صباح الخير|مساء الخير)[؟?! .]*$/i.test(q)) return ar
    ? 'مساء النور! 🌟 عامل إيه؟'
    : 'Good day! 🌟 How’s it going?';
  if (/^(bye|goodbye|see you|سلام|مع السلامة)[؟?! .]*$/i.test(q)) return ar
    ? 'مع السلامة! 👋 أتمنى لك يوم جميل.'
    : 'See you! 👋 Have a great day.';
  if (/^(thanks|thank you|شكرا|شكرًا|تسلم)/i.test(q)) return ar
    ? 'العفو! 🌟 لو عندك سؤال تاني عن الفضاء أنا جاهز.'
    : "You’re welcome! 🌟 I’m here if you have another space question.";
  if (/mars|المريخ/.test(q)) return ar
    ? 'المريخ كوكب صخري بارد، وغلافه الجوي رقيق ويتكوّن معظمه من ثاني أكسيد الكربون. توجد على سطحه آثار جيولوجية تشير إلى وجود مياه سائلة قديمًا. دي معلومات عامة وليست قراءة مباشرة لبيانات لحظية.\nمصدر موثوق: NASA — https://science.nasa.gov/mars/'
    : 'Mars is a cold, rocky planet with a thin atmosphere made mostly of carbon dioxide. Its surface preserves geological evidence that liquid water existed there in the past. This is general background, not a live data reading.\nTrusted source: NASA — https://science.nasa.gov/mars/';
  if (/moon|القمر/.test(q)) return ar
    ? 'القمر لا يملك غلافًا جويًا كثيفًا مثل الأرض، لذلك تتغير حرارة سطحه بشدة بين النهار والليل، وتوجد مناطق قطبية مظللة باستمرار قد تحتوي على جليد مائي.\nمصدر موثوق: NASA — https://science.nasa.gov/moon/'
    : 'The Moon has no thick atmosphere like Earth’s, so its surface temperature changes dramatically between day and night. Permanently shadowed polar regions may contain water ice.\nTrusted source: NASA — https://science.nasa.gov/moon/';
  if (/saturn|زحل/.test(q)) return ar
    ? 'زحل عملاق غازي مشهور بحلقاته الواسعة، وله عائلة كبيرة من الأقمار، من بينها تيتان وإنسيلادوس.\nمصدر موثوق: NASA — https://science.nasa.gov/saturn/'
    : 'Saturn is a gas giant famous for its broad rings. It has many moons, including Titan and Enceladus.\nTrusted source: NASA — https://science.nasa.gov/saturn/';
  if (/earth|الأرض/.test(q)) return ar
    ? 'الأرض كوكب صخري يمتلك ماءً سائلًا على سطحه وغلافًا جويًا غنيًا بالنيتروجين والأكسجين. لو تقصد معلومة محددة—مثل الحرارة أو الغلاف الجوي أو المدار—حددها لي.\nمصدر موثوق: NASA — https://science.nasa.gov/earth/'
    : 'Earth is a rocky planet with liquid water on its surface and an atmosphere rich in nitrogen and oxygen. If you want a specific detail—such as temperature, atmosphere, or orbit—tell me which one.\nTrusted source: NASA — https://science.nasa.gov/earth/';
  return ar
    ? 'أنا متخصص في الفضاء والكواكب والبعثات العلمية. مش عايز أخمّن إجابة مش مرتبطة بسؤالك؛ ممكن توضح سؤالك أو تذكر اسم الكوكب/القمر/المهمة اللي تقصدها؟ وللبيانات الموثوقة نبدأ بمصادر NASA وبيانات المهمات.'
    : "I specialize in space, planets, and scientific missions. I don’t want to guess or give you an unrelated answer. Could you clarify your question or tell me which planet, moon, or mission you mean? For reliable data, we can start with NASA and mission datasets.";
}
async function searchContextForChat(message) {
  // Retrieve a concise encyclopedia record for named space destinations; this is
  // supporting context, not a claim that NASA datasets were queried.
  const q = String(message || '').trim();
  if (!/(mars|moon|luna|earth|venus|mercury|jupiter|saturn|uranus|neptune|pluto|europa|titan|enceladus|المريخ|القمر|الأرض|الزهرة|عطارد|المشتري|زحل|أورانوس|نبتون)/i.test(q)) return null;
  try { return await encyclopediaLookup(q); } catch (_) { return null; }
}

async function nasaImageSearch(q) {
  const endpoint = new URL("https://images-api.nasa.gov/search");
  endpoint.searchParams.set("q", q);
  endpoint.searchParams.set("media_type", "image");
  endpoint.searchParams.set("page_size", "8");
  const r = await fetch(endpoint);
  if (!r.ok) throw new Error("NASA image search unavailable");
  const data = await r.json();
  return (data.collection?.items || []).slice(0,8).map(item => ({
    title:item.data?.[0]?.title || "NASA image",
    description:(item.data?.[0]?.description || "").replace(/<[^>]*>/g,"").slice(0,240),
    date:item.data?.[0]?.date_created || "",
    nasaId:item.data?.[0]?.nasa_id || "",
    image:item.links?.find(x=>x.render==="image")?.href || "",
    nasaUrl:item.data?.[0]?.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(item.data[0].nasa_id)}` : "https://images.nasa.gov/"
  }));
}
async function nasaNtrsSearch(query, limit=6) {
  const endpoint=new URL("https://ntrs.nasa.gov/api/citations/search");
  endpoint.searchParams.set("q",String(query||"").slice(0,220));
  endpoint.searchParams.set("page.size",String(Math.max(1,Math.min(10,limit))));
  const response=await fetch(endpoint,{headers:{"Accept":"application/json","User-Agent":"EARTIFY-Student-Research/1.0"},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`NASA NTRS returned ${response.status}`);
  const data=await response.json();
  return (data.results||[]).slice(0,limit).map(item=>({
    id:String(item.id||""),title:String(item.title||"Untitled NASA record"),
    abstract:String(item.abstract||item.description||"").replace(/<[^>]*>/g," ").slice(0,900),
    year:item.publicationDate||item.date||item.year||"",
    authors:Array.isArray(item.authors)?item.authors.map(a=>typeof a==="string"?a:(a.name||"")).filter(Boolean).slice(0,5):[],
    url:item.id?`https://ntrs.nasa.gov/citations/${encodeURIComponent(item.id)}`:"https://ntrs.nasa.gov/"
  }));
}
async function multiSourceResearchSearch(query, perSource=4) {
  const jobs=await Promise.allSettled([
    nasaNtrsSearch(query,perSource),
    fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${perSource}&select=DOI,title,author,published-print,published-online,URL`,{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error("Crossref unavailable");const d=await r.json();return (d.message?.items||[]).map(x=>({source:"Crossref",title:x.title?.[0]||"Untitled research work",year:x["published-print"]?.["date-parts"]?.[0]?.[0]||x["published-online"]?.["date-parts"]?.[0]?.[0]||"",authors:(x.author||[]).slice(0,5).map(a=>[a.given,a.family].filter(Boolean).join(" ")),url:x.URL||(x.DOI?`https://doi.org/${x.DOI}`:""),abstract:"Abstract not supplied by Crossref search."}));}),
    fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${perSource}`,{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error("arXiv unavailable");const xml=await r.text();return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m=>{const b=m[1];const get=tag=>{const hit=b.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)</"+tag+">"));return hit?hit[1]:"";};return {source:"arXiv",title:get("title").replace(/\s+/g," ").trim(),year:get("published").slice(0,4),authors:[...b.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].slice(0,5).map(a=>a[1]),url:get("id").trim(),abstract:get("summary").replace(/\s+/g," ").trim().slice(0,1000)};});})
  ]);
  const items=[];
  if(jobs[0].status==="fulfilled") items.push(...jobs[0].value.map(x=>({...x,source:"NASA NTRS"})));
  if(jobs[1].status==="fulfilled") items.push(...jobs[1].value);
  if(jobs[2].status==="fulfilled") items.push(...jobs[2].value);
  return {items,providers:{nasa:jobs[0].status==="fulfilled",crossref:jobs[1].status==="fulfilled",arxiv:jobs[2].status==="fulfilled"}};
}

function appendUserConversation(userId, role, content) {
  if(!userId) return;
  db.conversations.push({id:crypto.randomUUID(),userId,role,content:String(content||"").slice(0,3000),createdAt:new Date().toISOString()});
  const own=db.conversations.filter(x=>x.userId===userId);
  if(own.length>80){const remove=new Set(own.slice(0,own.length-80).map(x=>x.id));db.conversations=db.conversations.filter(x=>!remove.has(x.id));}
}

function rateLimit(req, res, limit=90, windowMs=60_000) {
  const key = `${req.socket.remoteAddress || "unknown"}:${req.method}:${new URL(req.url, "http://localhost").pathname}`;
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count++; requestBuckets.set(key, bucket);
  if (bucket.count > limit) { send(res, 429, { error: "Too many requests. Please wait a minute and try again." }); return false; }
  if (requestBuckets.size > 5000) for (const [k,v] of requestBuckets) if (now > v.reset) requestBuckets.delete(k);
  return true;
}
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (family === 6) {
    const lower=address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
    return lower === "::1" || lower === "::" || /^f[cd]/i.test(lower) || /^fe[89ab]/i.test(lower);
  }
  return true;
}
async function assertPublicHttpUrl(value) {
  const target = new URL(String(value));
  if (!["http:","https:"].includes(target.protocol) || target.username || target.password) throw new Error("Enter a public HTTP or HTTPS link without embedded credentials.");
  if (target.hostname === "localhost" || target.hostname.endsWith(".localhost")) throw new Error("Private network links are not allowed.");
  const records = net.isIP(target.hostname) ? [{address:target.hostname}] : await dns.lookup(target.hostname,{all:true,verbatim:true});
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error("Private or local network links are not allowed.");
  return target;
}
async function fetchPublicText(value) {
  let target = await assertPublicHttpUrl(value);
  for (let redirects=0; redirects<=3; redirects++) {
    const response = await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"User-Agent":"EARTIFY-Research/1.0"}});
    if ([301,302,303,307,308].includes(response.status)) {
      if (redirects === 3) throw new Error("Too many redirects while fetching this source.");
      const location=response.headers.get("location"); if(!location) throw new Error("The source returned an invalid redirect.");
      target=await assertPublicHttpUrl(new URL(location,target).href); continue;
    }
    if(!response.ok) throw new Error(`Could not fetch link (${response.status}).`);
    const type=response.headers.get("content-type")||"";
    if(!/text\//i.test(type)&&!/json|xml/i.test(type)) throw new Error("That link does not point to readable text or a webpage.");
    const body=await response.text(); if(body.length>500000) throw new Error("Linked source is too large to import (maximum 500 KB).");
    return {target,body,type};
  }
}

const requestHandler = async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") return send(res,204,{});
  if (url.pathname.startsWith("/api/") && !rateLimit(req,res,url.pathname.includes("robot-chat")?35:90)) return;
  if (req.method === "POST" && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return send(res,403,{error:"Cross-origin requests are not allowed."}); }
    catch { return send(res,403,{error:"Invalid request origin."}); }
  }
  if (url.pathname === "/api/health") return send(res,200,{ok:true,aiEnabled:!!process.env.OPENAI_API_KEY,semanticSearchEnabled:!!process.env.OPENAI_API_KEY,documentFormats:["TXT","MD","CSV","JSON","XML","HTML","PDF","DOCX"],researchProviders:["NASA NTRS","Crossref","arXiv"]});

  if (url.pathname === "/api/auth/signup" && req.method === "POST") {
    try { const x=await readBody(req), email=String(x.email||"").trim().toLowerCase(), name=String(x.name||"").trim().slice(0,60), password=String(x.password||"");
      if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||!name) return send(res,400,{error:"Enter a valid email, name, and password (8+ characters)."});
      if(db.users.length>=20) return send(res,403,{error:"The starter database is full (20 accounts)."});
      if(db.users.some(u=>u.email===email)) return send(res,409,{error:"An account with this email already exists."});
      const salt=crypto.randomBytes(16).toString("hex"), hash=crypto.scryptSync(password,salt,64).toString("hex"), user={id:crypto.randomUUID(),email,name,salt,hash,createdAt:new Date().toISOString()};
      db.users.push(user); const token=crypto.randomBytes(32).toString("hex"); db.sessions[token]=user.id; saveDB(); authCookie(res,token); return send(res,201,{user:publicUser(user)});
    } catch(e){return send(res,400,{error:e.message||"Could not create account."});}
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    try {const x=await readBody(req), email=String(x.email||"").trim().toLowerCase(), password=String(x.password||""), u=db.users.find(v=>v.email===email);
      const hash=u?crypto.scryptSync(password,u.salt,64).toString("hex"):"";
      if(!u||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(u.hash))) return send(res,401,{error:"Email or password is incorrect."});
      const token=crypto.randomBytes(32).toString("hex"); db.sessions[token]=u.id; saveDB(); authCookie(res,token); return send(res,200,{user:publicUser(u)});
    }catch(e){return send(res,400,{error:"Could not log in."});}
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") { delete db.sessions[cookieToken(req)]; saveDB(); res.setHeader("Set-Cookie","eartify_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return send(res,200,{ok:true}); }
  if (url.pathname === "/api/auth/me") { const u=currentUser(req); return send(res,200,{user:u?publicUser(u):null,accountLimit:20,accountCount:db.users.length}); }
  if (url.pathname === "/api/history") { const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to view your research history."}); return send(res,200,{items:db.history.filter(h=>h.userId===u.id).slice(-100).reverse().map(({userId,...item})=>item)}); }
  if (url.pathname === "/api/documents" && req.method === "GET") { const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to view saved files."}); return send(res,200,{items:db.documents.filter(d=>d.userId===u.id).map(({content,userId,...d})=>d)}); }
  if (url.pathname === "/api/documents" && req.method === "POST") {
    try {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in before saving files."}); const x=await readBody(req); let doc;
      if(x.url){const fetched=await fetchPublicText(x.url); const target=fetched.target; doc={name:target.hostname+target.pathname,content:fetched.body.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").slice(0,100000),source:target.href};
      } else doc={...extractTextFromUpload(x),source:"uploaded file"};
      if(!doc.content.trim())throw new Error("No readable text was found in this file or link."); const item={id:crypto.randomUUID(),userId:u.id,name:doc.name,source:doc.source||"uploaded file",content:doc.content,createdAt:new Date().toISOString()}; db.documents.push(item); saveDB(); return send(res,201,{document:{id:item.id,name:item.name,source:item.source,createdAt:item.createdAt,characters:item.content.length,extraction:"text"}});
    }catch(e){return send(res,400,{error:e.message||"Could not save this document."});}
  }
  if (url.pathname.startsWith("/api/documents/") && req.method === "DELETE") {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in first."}); const id=url.pathname.split("/").pop(); db.documents=db.documents.filter(d=>!(d.id===id&&d.userId===u.id)); saveDB(); return send(res,200,{ok:true});}
  if (url.pathname === "/api/documents/ask" && req.method === "POST") {
    try {const u=currentUser(req); if(!u)return send(res,401,{error:"Sign in to ask questions about saved files."}); const x=await readBody(req), question=String(x.question||"").trim(); if(!question)return send(res,400,{error:"Write a question first."});
      const docs=db.documents.filter(d=>d.userId===u.id), selected=x.documentId?docs.filter(d=>d.id===x.documentId):docs; if(!selected.length)return send(res,404,{error:"No saved document was found."});
      const retrieval=await retrieveHybridPassages(question,selected,{apiKey:process.env.OPENAI_API_KEY||"",model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",limit:10,cache:embeddingCache});
      let passages=retrieval.passages;
      if(!passages.length && /summari[sz]|لخص|ملخص/i.test(question)) passages=selected.flatMap(d=>splitIntoChunks(d.content).slice(0,2).map((chunk,index)=>({name:d.name,chunk,index,score:0})));
      const context=passages.map((p,i)=>`[${i+1}] FILE: ${p.name}\n${p.chunk}`).join("\n\n").slice(0,26000); let answer;
      if(process.env.OPENAI_API_KEY){const resp=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",messages:[{role:"system",content:"You are a careful document research assistant. Answer only from the retrieved passages. If they do not contain the answer, explicitly say the saved sources do not establish it. Cite the exact filename and passage number such as [filename, passage 2]. Never invent facts. Explain clearly and structurally."},{role:"user",content:`Question: ${question}\n\nRetrieved passages:\n${context||"No relevant passages were retrieved."}`}],temperature:.2}),signal:AbortSignal.timeout(60000)}); if(!resp.ok)throw new Error("AI document analysis is unavailable. Check the server API key."); const data=await resp.json(); answer=data.choices?.[0]?.message?.content||"No answer returned.";
      } else if(/summari[sz]|لخص|ملخص/i.test(question)){answer=selected.map(d=>`**${d.name}**\n${d.content.slice(0,1800)}${d.content.length>1800?"…":""}`).join("\n\n"); answer="Starter summary (AI key not configured):\n"+answer;}
      else {answer=passages.length?"Relevant passages (basic retrieval; AI key not configured):\n"+passages.map((p,i)=>`[${p.name}, passage ${i+1}]\n${p.chunk.slice(0,700)}`).join("\n\n"):"I couldn't retrieve a relevant passage from the saved sources. Configure OPENAI_API_KEY for natural-language synthesis.";}
      return send(res,200,{answer,mode:process.env.OPENAI_API_KEY?"ai":"basic",retrieval:retrieval.mode,citations:passages.map((p,i)=>({document:p.name,passage:i+1,score:Number(p.score||0).toFixed(3)}))});
    }catch(e){return send(res,502,{error:e.message||"Document question failed."});}
  }

  if (url.pathname === "/api/solve" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!input.place) return send(res,400,{error:"Please enter a destination name."});
      const result = await aiAnalysis(input);
      return send(res,200,result);
    } catch(e) { return send(res,502,{error:e.message || "Analysis failed"}); }
  }
  if (url.pathname === "/api/place-search" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!String(input.place || "").trim()) return send(res,400,{error:"Enter a place or thing to search for."});
      const first = await encyclopediaLookup(input.place);
      const second = String(input.place2 || "").trim() ? await encyclopediaLookup(input.place2) : null;
      const who=currentUser(req); if(who){db.history.push({id:crypto.randomUUID(),userId:who.id,query:[input.place,input.place2].filter(Boolean).join(" vs "),createdAt:new Date().toISOString()});saveDB();}
      return send(res,200,{first,second,source:"Wikimedia search API",disclaimer:(first.offline || second?.offline) ? "Internet connection is unavailable, so a built-in NASA topic reference is being shown for recognized Solar System objects. Other searches require a live connection." : "Search results are retrieved live from Wikipedia/Wikimedia. For scientific decisions, verify measurements with NASA/PDS primary datasets."});
    } catch(e) { return send(res,502,{error:e.message||"Research lookup failed"}); }
  }
  if (url.pathname === "/api/compare-text" && req.method === "POST") {
    try {
      const input = await readBody(req);
      if (!String(input.first || "").trim() || !String(input.second || "").trim()) return send(res,400,{error:"Enter both items to compare."});
      const [first, second] = await Promise.all([encyclopediaLookup(input.first), encyclopediaLookup(input.second)]);
      const who=currentUser(req); if(who){db.history.push({id:crypto.randomUUID(),userId:who.id,query:`${input.first} vs ${input.second}`,createdAt:new Date().toISOString()});saveDB();}
      return send(res,200,{first,second,source:"Wikimedia search API",disclaimer:(first.offline || second.offline) ? "Internet connection is unavailable; built-in NASA topic references are shown for recognized Solar System objects." : "A standard text comparison based on live reference summaries; it is separate from the 3D explorer."});
    } catch(e) { return send(res,502,{error:e.message||"Comparison search failed"}); }
  }
  if (url.pathname === "/api/robot-chat" && req.method === "POST") {
    try {
      const input=await readBody(req); const message=String(input.message||"").trim().slice(0,1200);
      if(!message) return send(res,400,{error:"Type a message first."});
      const signedIn=currentUser(req);
      if(looksLikeUnclearInput(message)) return send(res,200,{reply:robotReply(message),mode:"clarify"});
      if(!process.env.OPENAI_API_KEY) {
        const reply=robotReply(message);
        if(signedIn){appendUserConversation(signedIn.id,"user",message);appendUserConversation(signedIn.id,"assistant",reply);saveDB();}
        return send(res,200,{reply,mode:"guided",notice:"For open-ended conversational answers, configure OPENAI_API_KEY on the server."});
      }
      const evidence=await searchContextForChat(message);
      const clientHistory=Array.isArray(input.history) ? input.history.slice(-8).map(item=>({role:item.role==="assistant"?"assistant":"user",content:String(item.content||"").slice(0,1200)})) : [];
      const savedHistory=signedIn?db.conversations.filter(x=>x.userId===signedIn.id).slice(-10).map(x=>({role:x.role,content:x.content})):[];
      const history=(savedHistory.length?savedHistory:clientHistory).slice(-12);
      const userDocs=signedIn?db.documents.filter(d=>d.userId===signedIn.id):[];
      const docRetrieval=await retrieveHybridPassages(message,userDocs,{apiKey:process.env.OPENAI_API_KEY||"",model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",limit:4,cache:embeddingCache});
      const docPassages=docRetrieval.passages;
      const docContext=docPassages.map((p,i)=>`[${p.name}, passage ${i+1}] ${p.chunk}`).join("\n\n");
      const rawMessage=String(message||"");
      const hasArabicScript=/[\u0600-\u06FF]/.test(rawMessage);
      const looksArabizi=/\b(3ayz|3aiz|3rf|a3rf|eh|bt3ml|el|msh|mesh|ezay|leh|3shan|keda|b2a)\b/i.test(rawMessage);
      const replyLanguage=hasArabicScript ? "Egyptian Arabic" : looksArabizi ? "Egyptian Arabic (Arabizi-aware; answer in Arabic script unless the user consistently writes Franco)" : "English";
      const detectedIntent=classifyIntent(rawMessage);
      let researchResults={items:[],providers:{}};
      if(detectedIntent==="scientific_research" || /\b(nasa|ntrs|technical report|scientific paper|research paper|arxiv|crossref)\b/i.test(rawMessage)) {
        try { researchResults=await multiSourceResearchSearch(rawMessage,3); } catch (_) { researchResults={items:[],providers:{}}; }
      }
      const teachingMode=classifyTeachingMode(rawMessage);
      const teachingRequested=detectedIntent==="explanation" || /(step.?by.?step|i don.t understand|why does|how does|واحدة واحدة|خطوة بخطوة)/i.test(rawMessage);
      const systemPrompt=`Detected intent hint: ${detectedIntent}. Teaching depth hint: ${teachingMode}. These are fallible hints; follow the actual message and conversation, not the labels. You are Cero, EARTIFY's conversational AI, patient teacher, and careful research assistant. Reply in ${replyLanguage}; match the user's register naturally. Understand typos, informal wording, dialect, Arabizi, code-switching, short follow-ups, pronouns, and references using the conversation history. Do not assume two similar spellings always mean the same thing; use context and ask one concise clarification when intent remains genuinely ambiguous.

GENERAL CONVERSATION: Help with broad everyday, educational, technical, creative, and scientific questions, not only space. Be natural, relevant, non-repetitive, and answer the actual request. Keep simple requests concise; do not pad.

TEACHING: When the user wants to learn, ${teachingRequested ? "use a thorough step-by-step teaching approach for this turn." : "adapt the depth to their wording and demonstrated level."} Start from the prerequisite idea when needed; teach one concept at a time; explain what it means and WHY it works; define technical terms; show every meaningful algebra/calculation step; give a worked example and explain common mistakes. For math/physics identify givens, required quantity, formula and why it applies, substitution, calculation, units, and a reasonableness check. Do not skip transformations. If the learner says they are confused, change the explanation and example instead of repeating the same wording. For practice, ask one question at a time and wait for the answer; do not reveal the answer when they asked to try independently. Check understanding naturally without turning every answer into a quiz. Avoid an overwhelming wall of text: use clear stages and pause at a sensible point.

RESEARCH: For current or specialized scientific claims, retrieve evidence when tools are available. When NASA NTRS, Crossref, or arXiv records are supplied, cite exact record titles, source names, and URLs in your answer; describe them as search results, not as proof that the full paper was independently verified. Prefer NASA, NASA NTRS, NASA PDS, ESA, and peer-reviewed sources. Clearly distinguish retrieved evidence, general background knowledge, hypotheses, estimates, and unknowns. Never invent a paper, DOI, citation, measurement, search, or URL. Only say a source was searched if it was actually retrieved. If the supplied context is insufficient, say exactly what is missing and suggest a primary source. Do not treat an encyclopedia summary as primary mission data.

CONTEXT & PRIVACY: Use only the conversation history provided for this user. Resolve follow-up references from it. Never claim persistent memory across accounts or sessions. Do not reveal secrets or credentials. If asked to perform an action, use an available tool or clearly state what cannot be done.

STYLE: Be patient, encouraging, accurate, and specific. Never shame mistakes. Do not force every response into a space topic. Avoid generic filler and repetitive greetings. If uncertain, be transparent rather than pretending.`;
      const context=[
        evidence?.found ? `Retrieved background reference (Wikipedia summary, not a NASA dataset): ${JSON.stringify({title:evidence.title,extract:evidence.extract,url:evidence.url})}` : "No encyclopedia reference was retrieved.",
        researchResults.items.length ? `Scientific records retrieved live from NASA NTRS, Crossref, and/or arXiv: ${JSON.stringify(researchResults.items)}` : "No live scientific records were retrieved for this turn.",
        docContext ? `Relevant passages from this signed-in user's saved documents:\n${docContext}` : "No relevant passages were retrieved from the user's saved documents."
      ].join("\n\n");
      const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",messages:[{role:"system",content:systemPrompt},{role:"system",content:context},...history,{role:"user",content:message}],temperature:.25}),signal:AbortSignal.timeout(60000)});
      if(!response.ok) throw new Error("The AI service is temporarily unavailable. Check the server API key and try again."); const data=await response.json();
      const reply=data.choices?.[0]?.message?.content||(messageLanguage(message)==="ar" ? "معلش، حصلت مشكلة في فهم السؤال. ممكن تعيده بصياغة تانية؟" : "Sorry, I had trouble understanding that. Could you rephrase your question?");
      if(signedIn){appendUserConversation(signedIn.id,"user",message);appendUserConversation(signedIn.id,"assistant",reply);saveDB();}
      return send(res,200,{reply,mode:"ai",reference:evidence?.found?{name:evidence.title,url:evidence.url}:null,research:researchResults.items,researchProviders:researchResults.providers});
    } catch(e){return send(res,502,{error:e.message||"Chat failed"});}
  }
  if (url.pathname === "/api/research/search" && req.method === "GET") {
    const query=String(url.searchParams.get("q")||"").trim();
    if(query.length<3) return send(res,400,{error:"Enter at least 3 characters to search scientific literature."});
    const arxivUrl=`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`;
    const jobs=await Promise.allSettled([
      nasaNtrsSearch(query,5),
      fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&select=DOI,title,author,published-print,published-online,URL,type`,{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error("Crossref unavailable");const d=await r.json();return (d.message?.items||[]).map(x=>({source:"Crossref",title:x.title?.[0]||"Untitled research work",year:x["published-print"]?.["date-parts"]?.[0]?.[0]||x["published-online"]?.["date-parts"]?.[0]?.[0]||"",authors:(x.author||[]).slice(0,5).map(a=>[a.given,a.family].filter(Boolean).join(" ")),url:x.URL||(x.DOI?`https://doi.org/${x.DOI}`:""),abstract:"Abstract not supplied by Crossref search."}));}),
      fetch(arxivUrl,{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error("arXiv unavailable");const xml=await r.text();return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m=>{const b=m[1];const get=tag=>{const hit=b.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)</"+tag+">"));return hit?hit[1]:"";};return {source:"arXiv",title:get("title").replace(/\s+/g," ").trim(),year:get("published").slice(0,4),authors:[...b.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].slice(0,5).map(a=>a[1]),url:get("id").trim(),abstract:get("summary").replace(/\s+/g," ").trim().slice(0,1000)};});})
    ]);
    const items=[];
    if(jobs[0].status==="fulfilled") items.push(...jobs[0].value.map(x=>({...x,source:"NASA NTRS"})));
    if(jobs[1].status==="fulfilled") items.push(...jobs[1].value);
    if(jobs[2].status==="fulfilled") items.push(...jobs[2].value);
    return send(res,200,{query,items,providers:{nasa:jobs[0].status==="fulfilled",crossref:jobs[1].status==="fulfilled",arxiv:jobs[2].status==="fulfilled"},retrievedAt:new Date().toISOString(),notice:items.length?"Search results are discovery leads. Open and verify each original publication before citing it.":"All research providers are currently unavailable or returned no results."});
  }
  if (url.pathname === "/api/research/ntrs" && req.method === "GET") {
    try {
      const query=String(url.searchParams.get("q")||"").trim();
      if(query.length<3) return send(res,400,{error:"Enter at least 3 characters to search NASA technical reports."});
      const items=await nasaNtrsSearch(query,6);
      return send(res,200,{query,items,source:"NASA Technical Reports Server (NTRS)",sourceUrl:"https://ntrs.nasa.gov/",retrievedAt:new Date().toISOString()});
    } catch(e) { return send(res,502,{error:"NASA NTRS search is temporarily unavailable. Try again later."}); }
  }
  if (url.pathname === "/api/nasa-images") {
    try {
      const q = url.searchParams.get("q") || "Mars rover";
      return send(res,200,{items:await nasaImageSearch(q)});
    } catch(e) { return send(res,502,{error:e.message}); }
  }
  let pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = path.normalize(path.join(PUBLIC, pathname));
  if (!target.startsWith(PUBLIC)) return send(res,403,{error:"Forbidden"});
  fs.readFile(target,(err,buffer)=>{
    if (err) return send(res,404,"Not found","text/plain; charset=utf-8");
    send(res,200,buffer,MIME[path.extname(target)] || "application/octet-stream");
  });
};

// Vercel imports this handler as a serverless function. Local development
// still uses the same handler through a regular Node HTTP server.
if (require.main === module) {
  http.createServer(requestHandler).listen(PORT, "0.0.0.0", ()=>console.log(`EARTIFY running on port ${PORT}`));
}
module.exports = requestHandler;
