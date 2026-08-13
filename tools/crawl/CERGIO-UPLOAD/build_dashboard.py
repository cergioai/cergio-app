#!/usr/bin/env python3
"""Build a self-contained dashboard from records.json + quarantine.json."""
import json, os, html
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
recs = json.load(open(os.path.join(ROOT, "out", "records.json"), encoding="utf-8"))
quar = json.load(open(os.path.join(ROOT, "out", "quarantine.json"), encoding="utf-8"))


def prov(r, f, k):
    return ((r.get("provenance") or {}).get(f) or {}).get(k)


def note(r):
    n = []
    if r.get("flag_phone_out_of_metro"):
        n.append("phone from another region")
    if r.get("flag_email_offsite_domain"):
        n.append("email on a different company's domain")
    return " · ".join(n)


rows = [{
    "id": r["record_id"], "src": r.get("source") or "Unlabelled",
    "aud": r["audience"], "city": r["city"],
    "cat": r.get("service_type") or r.get("category") or "",
    "name": r.get("display_name") or "", "first": r.get("first_name") or "",
    "ig": r.get("ig_handle") or "", "fol": r.get("followers"),
    "tier": r.get("follower_tier") or "", "proof": r.get("ig_proof_strength") or "",
    "email": r.get("email") or "", "phone": r.get("phone") or "",
    "web": r.get("website_url") or "", "note": note(r), "hasig": bool(r.get("has_instagram")),
    "ok": bool(r.get("contactable")), "why": r.get("hold_reason") or "",
    "esrc": prov(r, "email", "source_url") or "", "psrc": prov(r, "phone", "source_url") or "",
} for r in recs]

held = []   # nothing is held any more — everything is in `rows`, labelled

payload = json.dumps({"rows": rows, "held": held,
                      "built": datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")},
                     separators=(",", ":"))

HTML = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cergio — Lead Sources</title>
<style>
:root{
  color-scheme:light;
  --plane:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --rule:#c3c2b7; --ring:rgba(11,11,11,.10);
  --bar:#2a78d6; --bar-soft:#cde2fb;
  --good:#0ca30c; --warn:#fab219; --serious:#ec835a; --crit:#d03b3b;
}
:root[data-theme=dark]{
  color-scheme:dark;
  --plane:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --rule:#383835; --ring:rgba(255,255,255,.10);
  --bar:#3987e5; --bar-soft:#184f95;
}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){
  color-scheme:dark;
  --plane:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7;
  --grid:#2c2c2a; --rule:#383835; --ring:rgba(255,255,255,.10);
  --bar:#3987e5; --bar-soft:#184f95;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);
  font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:32px 24px 80px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:4px}
h1{font-size:19px;font-weight:650;margin:0;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:12.5px}
button,select,input{font:inherit;color:inherit}
.ghost{background:none;border:1px solid var(--ring);border-radius:7px;padding:5px 11px;
  cursor:pointer;color:var(--ink2);font-size:12.5px}
.ghost:hover{background:var(--surface);color:var(--ink)}

.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  background:var(--grid);border:1px solid var(--grid);border-radius:12px;overflow:hidden;margin:22px 0 26px}
.hero div{background:var(--surface);padding:16px 18px}
.hero .n{font-size:27px;font-weight:640;letter-spacing:-.02em;line-height:1.15}
.hero .l{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.055em;margin-top:3px}
.hero .h{color:var(--ink2);font-size:12px;margin-top:5px}

.bar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
select,input[type=search]{background:var(--surface);border:1px solid var(--ring);
  border-radius:7px;padding:6px 10px;font-size:13px}
input[type=search]{min-width:210px}

h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  font-weight:600;margin:30px 0 11px}
.card{background:var(--surface);border:1px solid var(--grid);border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);font-weight:600;padding:11px 14px;border-bottom:1px solid var(--grid);white-space:nowrap}
td{padding:11px 14px;border-bottom:1px solid var(--grid);vertical-align:middle}
tr:last-child td{border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:hover td{background:color-mix(in srgb,var(--bar) 5%,transparent)}

.track{height:9px;background:var(--grid);border-radius:5px;overflow:hidden;min-width:90px}
.fill{height:100%;background:var(--bar);border-radius:0 4px 4px 0}
.srcname{font-weight:600}
.srcsub{color:var(--muted);font-size:11.5px;margin-top:2px}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink2);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  color:var(--ink2);white-space:nowrap}
td.mono,td .mono{white-space:nowrap}
#tbody td{padding:10px 12px}
#tbody td:first-child{min-width:190px}
a{color:var(--bar);text-decoration:none}
a:hover{text-decoration:underline}
.flag{color:var(--serious);font-size:11.5px}
.tag{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:20px;
  border:1px solid var(--ring);color:var(--ink2);white-space:nowrap}
.empty{padding:34px;text-align:center;color:var(--muted)}
.foot{margin-top:34px;color:var(--muted);font-size:12px;line-height:1.7}
.scroll{max-height:620px;overflow:auto}
.scroll thead th{position:sticky;top:0;background:var(--surface);z-index:1}
@media(max-width:720px){.hide-s{display:none}.wrap{padding:20px 14px 60px}}
</style></head><body>
<div class="wrap">
<header>
  <div>
    <h1>Lead Sources</h1>
    <div class="sub" id="built"></div>
  </div>
  <div style="display:flex;gap:8px">
    <button class="ghost" id="theme">Dark</button>
    <button class="ghost" id="dlall">Download all CSV</button>
  </div>
</header>

<div class="hero" id="hero"></div>

<h2>Sources</h2>
<div class="card"><table>
<thead><tr>
  <th>Source</th><th class="num">Leads</th><th class="hide-s">Share</th>
  <th class="num">Email</th><th class="num">Phone</th><th class="num hide-s">Instagram</th>
  <th>Contactable</th><th class="num"></th>
</tr></thead><tbody id="srcbody"></tbody></table></div>

<h2>Leads</h2>
<div class="bar">
  <select id="fsrc"></select>
  <select id="fcity"><option value="">All cities</option><option>NYC</option><option>MIA</option></select>
  <select id="faud"><option value="">All audiences</option>
    <option value="creator">Creators</option><option value="service">Services</option>
    <option value="realestate">Real estate agents</option>
    <option value="localbiz">Local businesses</option></select>
  <select id="fq"><option value="contactable">Contactable (email or phone)</option>
    <option value="">Everything, including incomplete</option>
    <option value="incomplete">Incomplete only</option>
    <option value="both">Has email and phone</option>
    <option value="email">Has email</option>
    <option value="flag">Needs a look</option>
    <option value="2500">Creators over 2,500</option>
    <option value="hasig">Has Instagram</option>
    <option value="noig">No Instagram</option></select>
  <input type="search" id="q" placeholder="Search name, handle, email…">
  <button class="ghost" id="dlfilt">Download these</button>
</div>
<div class="card"><div class="scroll"><table>
<thead><tr><th>Name</th><th class="hide-s">Type</th><th>Instagram</th>
  <th class="num hide-s">Followers</th><th>Email</th><th class="num">Phone</th></tr></thead>
<tbody id="tbody"></tbody></table></div></div>
<div class="sub" id="count" style="margin-top:9px"></div>

<div class="foot">
  Every value here was found on the page it links to — nothing is inferred, and anything
  unproven is left blank rather than guessed.<br>
  <b>Nothing is dropped.</b> Every entity crawled is here; the filter opens on the
  contactable set and one click shows the rest, with the reason on each row.
  <b>Contactable</b> means the lead has an email or a phone number. <b>Needs a look</b> flags rows
  where the phone's area code is from another region, or the email belongs to a different
  company than the website — usually fine, occasionally a web designer's address.
</div>
</div>
<script>
const DATA = __PAYLOAD__;
const $ = s => document.querySelector(s);
const esc = s => (s??"").toString().replace(/[<>&"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const pct = (a,b) => b ? Math.round(a/b*100) : 0;
$("#built").textContent = "Built " + DATA.built + " · " + DATA.rows.length + " leads from "
  + new Set(DATA.rows.map(r=>r.src)).size + " sources";

/* ---- hero ---------------------------------------------------------- */
const R = DATA.rows;
const creators = R.filter(r=>r.aud==="creator"), services = R.filter(r=>r.aud==="service");
const withFol = creators.filter(r=>r.fol!=null);
const hero = [
  ["Crawled", R.length, R.filter(r=>r.city==="NYC").length + " NYC · " + R.filter(r=>r.city==="MIA").length + " Miami"],
  ["Creators", creators.length, withFol.length ? withFol.filter(r=>r.fol>=2500).length+" over 2,500 followers" : "follower counts pending"],
  ["Services", services.length, services.filter(r=>r.ig).length + " with Instagram"],
  ["On Instagram", R.filter(r=>r.hasig).length,
   pct(R.filter(r=>r.hasig).length,R.length)+"% of all leads · convertible"],
  ["Contactable", R.filter(r=>r.ok).length,
   R.filter(r=>r.email).length+" email · "+R.filter(r=>r.phone).length+" phone"],
  ["Email and phone", R.filter(r=>r.email&&r.phone).length,
   pct(R.filter(r=>r.email&&r.phone).length,R.length)+"% reachable two ways"],
];
$("#hero").innerHTML = hero.map(([l,n,h])=>
  `<div><div class="n">${n.toLocaleString()}</div><div class="l">${l}</div><div class="h">${h}</div></div>`).join("");

/* ---- sources ------------------------------------------------------- */
const bySrc = {};
R.forEach(r => (bySrc[r.src] ??= []).push(r));
const srcs = Object.entries(bySrc).sort((a,b)=>b[1].length-a[1].length);
const max = Math.max(...srcs.map(([,v])=>v.length));
/* Email coverage is the number that actually moves between sources. Contactable
   is a pass/fail gate, so charting it would show 100% forever — a metric that
   cannot vary tells you nothing. */
const health = p => p>=70 ? ["var(--good)","Strong"] : p>=45 ? ["var(--warn)","Fair"]
              : p>=25 ? ["var(--serious)","Thin"] : ["var(--crit)","Poor"];
$("#srcbody").innerHTML = srcs.map(([name,v])=>{
  const c = v.filter(r=>r.ok).length, p = pct(c,v.length);
  const [col,lab] = health(p);
  const KIND={creator:"creators",service:"service providers",
              realestate:"real estate agents",localbiz:"local businesses"};
  const kind = KIND[v[0].aud] || v[0].aud;
  const igN = v.filter(r=>r.hasig).length;
  return `<tr>
    <td><div class="srcname">${esc(name)}</div><div class="srcsub">${kind}</div></td>
    <td class="num">${v.length}</td>
    <td class="hide-s"><div class="track"><div class="fill" style="width:${v.length/max*100}%"></div></div></td>
    <td class="num">${v.filter(r=>r.email).length}</td>
    <td class="num">${v.filter(r=>r.phone).length}</td>
    <td class="num hide-s">${igN}<span class="srcsub" style="display:inline;margin-left:5px">${pct(igN,v.length)}%</span></td>
    <td><span class="pill"><span class="dot" style="background:${col}"></span>${lab} · ${p}%</span></td>
    <td class="num"><button class="ghost" data-src="${esc(name)}">CSV</button></td></tr>`;
}).join("");
$("#fsrc").innerHTML = `<option value="">All sources</option>` +
  srcs.map(([n])=>`<option>${esc(n)}</option>`).join("");

/* ---- table --------------------------------------------------------- */
function filtered(){
  const s=$("#fsrc").value, c=$("#fcity").value, a=$("#faud").value,
        q=$("#q").value.toLowerCase().trim(), qual=$("#fq").value;
  return R.filter(r=>{
    if(s&&r.src!==s) return false;
    if(c&&r.city!==c) return false;
    if(a&&r.aud!==a) return false;
    if(qual==="contactable"&&!r.ok) return false;
    if(qual==="incomplete"&&r.ok) return false;
    if(qual==="both"&&!(r.email&&r.phone)) return false;
    if(qual==="email"&&!r.email) return false;
    if(qual==="flag"&&!r.note) return false;
    if(qual==="2500"&&!(r.aud==="creator"&&r.fol>=2500)) return false;
    if(qual==="hasig"&&!r.hasig) return false;
    if(qual==="noig"&&r.hasig) return false;
    if(q&&!`${r.name} ${r.ig} ${r.email} ${r.cat} ${r.phone}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function render(){
  const f=filtered();
  $("#count").textContent = f.length===R.length
    ? `Showing all ${f.length} leads` : `Showing ${f.length} of ${R.length} leads`;
  $("#tbody").innerHTML = f.length ? f.slice(0,600).map(r=>`<tr>
    <td><div style="font-weight:550">${esc(r.name)||"—"}</div>
        ${r.why?`<div class="srcsub">${esc(r.why)}</div>`:
          r.note?`<div class="flag">${esc(r.note)}</div>`:
          r.first?`<div class="srcsub">${esc(r.first)}</div>`:""}</td>
    <td class="hide-s"><span class="tag">${esc(r.cat)||"—"}</span></td>
    <td>${r.ig?`<a href="https://instagram.com/${esc(r.ig)}" target="_blank" rel="noopener">@${esc(r.ig)}</a>`:"—"}</td>
    <td class="num hide-s">${r.fol!=null?r.fol.toLocaleString():'<span style="color:var(--muted)">—</span>'}</td>
    <td>${r.email?`<a class="mono" href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:"—"}</td>
    <td class="mono num">${esc(r.phone)||"—"}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">Nothing matches those filters.</td></tr>`;
}
["#fsrc","#fcity","#faud","#fq"].forEach(s=>$(s).addEventListener("change",render));
$("#q").addEventListener("input",render);
$("#fq").value="contactable";      // open on the usable set; everything is one click away
render();

/* ---- download ------------------------------------------------------ */
const COLS=[["id","record_id"],["src","source"],["aud","audience"],["city","city"],
  ["cat","type"],["name","name"],["first","first_name"],["ig","instagram"],["fol","followers"],
  ["tier","follower_tier"],["email","email"],["esrc","email_found_on"],["phone","phone"],
  ["psrc","phone_found_on"],["web","website"],["proof","instagram_proof"],["note","check_this"]];
function csv(list,file){
  const q=v=>{v=v==null?"":String(v);return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const body=[COLS.map(c=>c[1]).join(","),...list.map(r=>COLS.map(c=>q(r[c[0]])).join(","))].join("\\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\\ufeff"+body],{type:"text/csv;charset=utf-8"}));
  a.download=file; a.click(); URL.revokeObjectURL(a.href);
}
$("#dlall").onclick=()=>csv(R,"cergio-all-leads.csv");
$("#dlfilt").onclick=()=>csv(filtered(),"cergio-leads-filtered.csv");
document.querySelectorAll("[data-src]").forEach(b=>b.onclick=()=>{
  const n=b.dataset.src; csv(bySrc[n],"cergio-"+n.toLowerCase().replace(/[^a-z0-9]+/g,"-")+".csv");});

/* ---- theme --------------------------------------------------------- */
const t=$("#theme");
const dark=()=>document.documentElement.dataset.theme==="dark"
  || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme:dark)").matches);
const sync=()=>t.textContent=dark()?"Light":"Dark";
t.onclick=()=>{document.documentElement.dataset.theme=dark()?"light":"dark";sync()};
sync();
</script></body></html>"""

out = os.path.join(ROOT, "out", "cergio-dashboard.html")
open(out, "w", encoding="utf-8").write(HTML.replace("__PAYLOAD__", payload))
print(f"{out}  ({os.path.getsize(out)//1024} KB, {len(rows)} leads, {len(held)} held)")
