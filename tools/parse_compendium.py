"""Parse Destiny Data Compendium CSV tabs (plus Bungie manifest extracts from fetch_sources.py) into src/compendium.ts."""
import csv, json, re, sys
src, out = sys.argv[1], sys.argv[2]
ELEMENTS = ['Solar', 'Arc', 'Void', 'Stasis', 'Strand']
PREFIX = {'Solar': 'Ember of', 'Arc': 'Spark of', 'Void': 'Echo of', 'Stasis': 'Whisper of', 'Strand': 'Thread of'}
CLASSES = {'Hunter': 'Hunter', 'Hunters': 'Hunter', 'Titan': 'Titan', 'Titans': 'Titan', 'Warlock': 'Warlock', 'Warlocks': 'Warlock'}
SECTIONS = {'Class Abilities': None, 'Melee Abilities': 'melee', 'Super Abilities': 'super', 'Aspects': 'aspect', 'Aspect': 'aspect'}

def clean(s): return re.sub(r'\s+', ' ', s.replace('\n', ' ')).strip()
def brief(s, n=220):
    # Skip header lines: super boilerplate and grenade trajectory tags ("Medium Trajectory | Seekers").
    paras = [p.strip() for p in s.split('\n\n') if p.strip() and not p.strip().startswith('General Super Information')
             and not (len(p.strip()) < 80 and 'Trajectory' in p)]
    t = clean(paras[0] if paras else s)
    return t if len(t) <= n else t[:n - 1].rsplit(' ', 1)[0] + '…'
def rows(name): return list(csv.reader(open(f'{src}/{name}.csv', encoding='utf-8')))
def cell(r, i): return r[i] if i < len(r) else ''

data = {'fragments': {}, 'grenades': {}, 'kits': {c: {} for c in ['Hunter', 'Titan', 'Warlock']}, 'desc': {}}
for el in ELEMENTS:
    R = rows(el)
    i = next(k for k, r in enumerate(R) if cell(r, 1).strip() == 'Fragments')
    frags, gren = [], []
    k = i + 1
    while not cell(R[k], 1).strip().startswith('Grenade Abilities'):
        n = clean(cell(R[k], 1))
        if n:
            full = f'{PREFIX[el]} {n}'
            frags.append(full); data['desc'][f'{el}|fragment|{full}'] = brief(cell(R[k], 3))
        k += 1
    k += 1
    def is_class_header(k):
        # Most tabs label it; some use '-' placeholders. A header row is followed by a section heading.
        c0 = clean(cell(R[k], 0))
        return c0 in CLASSES or (c0 == '-' and k + 1 < len(R) and clean(cell(R[k + 1], 1)) in SECTIONS)
    while not is_class_header(k):
        n = clean(cell(R[k], 1))
        if n and 'Base Cooldown' in cell(R[k], 13):
            gren.append(n); data['desc'][f'{el}|grenade|{n}'] = brief(cell(R[k], 3))
        k += 1
    # Bungie's names where the sheet abbreviates.
    gren = [{'Slicewire': 'Slicewire Grenade'}.get(g, g) for g in gren]
    for g in list(data['desc']):
        if g == f'{el}|grenade|Slicewire': data['desc'][f'{el}|grenade|Slicewire Grenade'] = data['desc'].pop(g)
    data['fragments'][el], data['grenades'][el] = frags, gren
    cls, sec, order = None, None, iter(['Hunter', 'Titan', 'Warlock'])
    for kk in range(k, len(R)):
        r = R[kk]
        n = clean(cell(r, 1))
        if is_class_header(kk):
            cls, sec = next(order), None
            data['kits'][cls][el] = {'super': [], 'melee': [], 'aspect': []}
            continue
        if n in SECTIONS: sec = SECTIONS[n]; continue
        if not n or not sec or not cls or '(' in n: continue
        n = n.replace(': ', ': ')
        data['kits'][cls][el][sec].append(n)
        data['desc'][f'{el}|{sec}|{n}'] = brief(cell(r, 3))

# ---- Prismatic: which abilities each class can slot comes from Bungie's subclass sockets
# (subclass_plugs.json); Facets and the Prismatic grenades come from the sheet's Prismatic tab.
plugs = json.load(open(f'{src}/subclass_plugs.json', encoding='utf-8'))
nkey = lambda x: re.sub(r'[^a-z0-9]', '', x.lower().replace('&', 'and'))
R = rows('Prismatic')
fi = next(k for k, r in enumerate(R) if clean(cell(R[k], 1)) == 'Fragments')
facets = []
k = fi + 1
while clean(cell(R[k], 0)) not in CLASSES:
    n = clean(cell(R[k], 1))
    if n:
        full = f'Facet of {n}'
        facets.append(full); data['desc'][f'Prismatic|fragment|{full}'] = brief(cell(R[k], 3))
    k += 1
manifest_facets = {nkey(x) for x in plugs['Prismatic Hunter'].get('Prismatic Fragment', [])}
assert {nkey(x) for x in facets} == manifest_facets, ('facet mismatch', facets)
data['fragments']['Prismatic'] = facets
prism_gren, order = {}, iter(['Hunter', 'Titan', 'Warlock'])
for kk in range(k, len(R)):
    if clean(cell(R[kk], 0)) in CLASSES or (clean(cell(R[kk], 0)) == '-' and clean(cell(R[kk], 1)) == '-'):
        cls = next(order)
        n = clean(cell(R[kk + 1], 1))
        if 'Prismatic Grenade' in cell(R[kk + 1], 3):
            prism_gren[cls] = n
            data['desc'][f'Prismatic|grenade|{n}'] = brief(cell(R[kk + 1], 3).split('\n\n', 1)[-1])
data['grenades']['Prismatic'] = []
for cls in ['Hunter', 'Titan', 'Warlock']:
    sock = plugs[f'Prismatic {cls}']
    kit = {'super': [], 'melee': [], 'aspect': [], 'grenade': []}
    for t, names in sock.items():
        m = re.match(r'(Solar|Arc|Void|Stasis|Strand) (Super|Melee|Grenade|Aspect)\b', t)
        if not m: continue
        el, kind = m.group(1), m.group(2).lower()
        pool = data['grenades'][el] if kind == 'grenade' else data['kits'][cls][el][kind]
        for n in names:
            spelled = next((x for x in pool if nkey(x) == nkey(n)), n)  # keep the sheet's spelling
            kit[kind].append(spelled)
            src_desc = data['desc'].get(f'{el}|{kind}|{spelled}')
            if src_desc: data['desc'][f'Prismatic|{kind}|{spelled}'] = f'{el}. {src_desc}'
    if cls in prism_gren: kit['grenade'].insert(0, prism_gren[cls])
    data['kits'][cls]['Prismatic'] = kit
print('prismatic', {c: {k: v for k, v in data['kits'][c]['Prismatic'].items()} for c in ['Hunter', 'Titan', 'Warlock']})

# ---- Exotic armor: name/perk/notes; synergy inferred from perk text
R = rows('ExoticArmors')
exotics = {'Hunter': [], 'Titan': [], 'Warlock': []}
cols = [('Hunter', 0), ('Titan', 3), ('Warlock', 6)]
k = 3
while k < len(R):
    r = R[k]
    if clean(cell(r, 0)) == 'Aeon Sects':
        r2 = R[k + 1]
        for cls, c in cols:
            nm = clean(cell(r2, c).split('\n')[0])
            if nm: exotics[cls].append({'name': nm, 'perk': clean(cell(r2, c).split('\n')[-1]), 'notes': cell(r2, c + 2)})
        break
    if any(cell(r, c + 2).strip() for _, c in cols):
        perk = R[k + 1] if k + 1 < len(R) else []
        for cls, c in cols:
            nm = clean(cell(r, c))
            if nm: exotics[cls].append({'name': nm, 'perk': clean(cell(perk, c)), 'notes': cell(r, c + 2)})
        k += 2
    else:
        k += 1

def synergy(cls, notes):
    score = {}
    for el in ELEMENTS:
        words = [el] + data['grenades'][el] + [x for v in data['kits'][cls].get(el, {}).values() for x in v]
        words += [w.replace(' Grenade', '') + ' Grenade' for w in data['grenades'][el]]
        s = 0
        for w in set(words):
            if len(w) >= 4: s += len(re.findall(r'\b' + re.escape(w) + r'\b', notes))
        score[el] = s
    best = max(score.values())
    winners = [e for e, v in score.items() if v == best]
    return winners[0] if best > 0 and len(winners) == 1 else None

# Slots come from Bungie's manifest (exotic_slots.json); names follow Bungie.
ALIAS = {'Sect of Force': 'Aeon Swift', 'Sect of Insight': 'Aeon Safe', 'Sect of Vigor': 'Aeon Soul',
         'Loreley Splendor': 'Loreley Splendor Helm', 'Promethium Spurs': 'Promethium Spur'}
slots = json.load(open(f'{src}/exotic_slots.json', encoding='utf-8'))
norm = lambda x: re.sub(r'[^a-z0-9]', '', x.lower().replace('\u2019', "'"))
unmatched = []
for cls, lst in exotics.items():
    by = {norm(k): (k, v) for k, v in slots[cls].items()}
    for e in lst:
        hit = by.get(norm(ALIAS.get(e['name'], e['name'])))
        if hit: e['name'], e['slot'] = hit
        else: e['slot'] = None; unmatched.append((cls, e['name']))
for cls, lst in exotics.items():
    for e in lst:
        e['synergy'] = synergy(cls, e['notes'])
        e['brief'] = brief(e['notes'], 240)
        del e['notes']
data['exotics'] = exotics

ts = '// Generated from the Destiny Data Compendium and the Bungie manifest by tools/parse_compendium.py. Do not edit by hand.\n'
ts += '/* eslint-disable */\n'
ts += f'export const COMPENDIUM = {json.dumps(data, ensure_ascii=False, indent=1)} as const\n'
open(out, 'w', encoding='utf-8').write(ts)
print('fragments', {e: len(v) for e, v in data['fragments'].items()})
print('grenades', {e: len(v) for e, v in data['grenades'].items()})
for c, kits in data['kits'].items():
    print(c, {e: {k: len(v) for k, v in kit.items()} for e, kit in kits.items()})
print('unmatched', unmatched)
print('exotics', {c: len(v) for c, v in exotics.items()}, 'with synergy', {c: sum(1 for e in v if e['synergy']) for c, v in exotics.items()})
