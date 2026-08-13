import json, glob, os, hashlib, re, random
os.chdir(os.path.dirname(os.path.abspath(__file__)))
recs=json.load(open('out/records.json'))
arts={}
for p in glob.glob('raw/*.json'):
    a=json.load(open(p)); arts[a.get('artifact_id') or os.path.basename(p)[:-5]]=a
bad=[]; checked=0
for r in recs:
    for f in ('email','phone','ig_handle','geo'):
        p=(r.get('provenance') or {}).get(f)
        if not p or not p.get('artifact_id'): continue
        a=arts.get(p['artifact_id'])
        if not a: bad.append((r['record_id'],f,'artifact missing')); continue
        if hashlib.sha256(a['content'].encode()).hexdigest()!=p['artifact_sha256']:
            bad.append((r['record_id'],f,'hash mismatch')); continue
        needle=p.get('as_printed') or p['value']
        seg=a['content'][p['offset']:p['offset']+len(needle)]
        if seg!=needle: bad.append((r['record_id'],f,f'offset mismatch {seg!r}!={needle!r}'))
        if a['url']!=p['source_url']: bad.append((r['record_id'],f,'url mismatch'))
        checked+=1
print(f'provenance assertions re-verified independently: {checked}')
print(f'failures: {len(bad)}')
for b in bad[:10]: print('  ',b)
# independent re-derivation of email, different regex, must agree
E=re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
dis=0
for r in recs:
    p=(r.get('provenance') or {}).get('email')
    if not p: continue
    a=arts[p['artifact_id']]
    if p['value'] not in [m.group(0).lower() for m in E.finditer(a['content'])]: dis+=1
print(f'emails not reproducible by an independent regex: {dis}')
