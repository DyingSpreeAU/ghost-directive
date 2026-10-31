"""Download the Destiny Data Compendium tabs and the Bungie manifest pieces that
parse_compendium.py needs, into a working directory.

    python3 tools/fetch_sources.py /tmp/gd-sources public/bungie-items.json public/bungie-icons.json public/bungie-exotics.json public/bungie-tiers.json src/artifactText.ts src/abilityText.ts
    python3 tools/parse_compendium.py /tmp/gd-sources src/compendium.ts

The second argument writes the compact weapon/armor lookup table the app uses to
name items from a signed-in player's Vault (hash -> name, slot, tier, class, damage).
The third writes icon paths by name: weapons and armor, and subclass and artifact plugs.

Needs network access to docs.google.com and *.bungie.net. The full item
definition file is about 200 MB.
"""
import collections, json, os, re, sys, time, urllib.error, urllib.request

out = sys.argv[1]
item_table = sys.argv[2] if len(sys.argv) > 2 else None
icon_table = sys.argv[3] if len(sys.argv) > 3 else None
exotic_table = sys.argv[4] if len(sys.argv) > 4 else None
tier_table = sys.argv[5] if len(sys.argv) > 5 else None
artifact_text = sys.argv[6] if len(sys.argv) > 6 else None
ability_text = sys.argv[7] if len(sys.argv) > 7 else None
os.makedirs(out, exist_ok=True)
SHEET = 'https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/gviz/tq?tqx=out:csv&gid='
TABS = {'Arc': 618967225, 'Solar': 1186062409, 'Void': 1907852650, 'Stasis': 1088259962,
        'Strand': 1870531554, 'Prismatic': 1918152785, 'ExoticArmors': 1500097863,
        'ArtifactPerks': 473308249}

# The game's inline icon tokens: "[Arc]Arc", "[Stagger] Unstoppable", "[Melee] : Hold...". Element and
# Champion icons are dropped (the word follows them); button prompts become plain words.
ICON_ONLY = {'Arc', 'Solar', 'Void', 'Stasis', 'Strand', 'Kinetic', 'Prismatic', 'Stagger', 'Disruption', 'Shield-Piercing'}
def clean_text(t):
    t = re.sub(r'\[([A-Za-z -]+)\][ \t]*', lambda m: '' if m.group(1) in ICON_ONLY else m.group(1) + ' ', t)
    t = re.sub(r' +:', ':', t)
    t = re.sub(r'[ \t]{2,}', ' ', t)
    return '\n'.join(line.strip() for line in t.split('\n')).strip()

def get(url, path=None, tries=5):
    # Bungie's servers sometimes answer 5xx or drop the connection: try again, waiting longer each time.
    for n in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                data = r.read()
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if n == tries - 1 or (isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429):
                raise
            print('retrying', url, e)
            time.sleep(5 * 2 ** n)
    if path:
        open(path, 'wb').write(data)
    return data

for name, gid in TABS.items():
    get(SHEET + str(gid), f'{out}/{name}.csv')
    print('sheet', name)

manifest = json.loads(get('https://www.bungie.net/Platform/Destiny2/Manifest/'))['Response']
paths = manifest['jsonWorldComponentContentPaths']['en']
print('manifest', manifest['version'])
items = json.loads(get('https://www.bungie.net' + paths['DestinyInventoryItemDefinition']))
plugsets = json.loads(get('https://www.bungie.net' + paths['DestinyPlugSetDefinition']))

CLS = {0: 'Titan', 1: 'Hunter', 2: 'Warlock'}
SLOT = {'Helmet': 'Helmet', 'Gauntlets': 'Gauntlets', 'Chest Armor': 'Chest', 'Leg Armor': 'Legs'}

# Exotic armor slots by class (Exotic class items are left out).
slots = collections.defaultdict(dict)
for it in items.values():
    if it.get('itemType') == 2 and it.get('inventory', {}).get('tierType') == 6 and it.get('classType') in CLS:
        t = it.get('itemTypeDisplayName', '')
        name = it.get('displayProperties', {}).get('name', '').strip()
        if name and t in SLOT:
            slots[CLS[it['classType']]][name] = SLOT[t]
json.dump(slots, open(f'{out}/exotic_slots.json', 'w'), indent=1, ensure_ascii=False)

# What each subclass can socket, grouped by plug type ("Arc Super | Light Ability", ...).
subs = {}
for it in items.values():
    if it.get('itemType') != 16 or it.get('classType') not in CLS:
        continue
    got = collections.defaultdict(list)
    for se in it.get('sockets', {}).get('socketEntries', []):
        for key in ('reusablePlugSetHash', 'randomizedPlugSetHash'):
            for p in plugsets.get(str(se.get(key)), {}).get('reusablePlugItems', []):
                pi = items.get(str(p['plugItemHash']))
                if pi and pi['displayProperties']['name'] not in got[pi.get('itemTypeDisplayName', '')]:
                    got[pi.get('itemTypeDisplayName', '')].append(pi['displayProperties']['name'])
    subs[it['displayProperties']['name']] = got
json.dump(subs, open(f'{out}/subclass_plugs.json', 'w'), indent=1, ensure_ascii=False)
print('wrote exotic_slots.json and subclass_plugs.json')

# Compact lookup table for Bungie sign-in: weapons and armor by item hash.
# Row: [name, slot index (ALL_SLOTS order), tier (0 Common .. 4 Exotic), classType (3 = any), damageType]
if item_table:
    BUCKET = {1498876634: 0, 2465295065: 1, 953998645: 2, 3448274439: 3, 3551918588: 4, 14239492: 5, 20886954: 6, 1585787867: 7}
    TIER = {2: 0, 3: 1, 4: 2, 5: 3, 6: 4}
    rows = {}
    for h, it in items.items():
        inv = it.get('inventory', {})
        name = it.get('displayProperties', {}).get('name', '').strip()
        if it.get('itemType') in (2, 3) and inv.get('bucketTypeHash') in BUCKET and inv.get('tierType') in TIER and name and not it.get('redacted'):
            rows[h] = [name, BUCKET[inv['bucketTypeHash']], TIER[inv['tierType']], it.get('classType', 3), it.get('defaultDamageType', 0)]
    json.dump({'version': manifest['version'], 'items': rows}, open(item_table, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print('wrote', item_table, len(rows), 'items')

# Icons by name, as paths under /common/destiny2_content/icons/: gear in the item table, and the
# subclass and artifact plugs the run screen shows.
if item_table and icon_table:
    PRE = '/common/destiny2_content/icons/'
    gear, plugs = {}, {}
    # An armor set's pieces share one name across slots: those also get an icon per "name|slot".
    SLOTS = ['Kinetic', 'Energy', 'Power', 'Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class Item']
    # Some weapons share a name across rarities too (a grey and a Legendary Khvostov 7G-02): those get "name|slot|Rarity".
    TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Exotic']
    by_slot, slots_of, by_tier, tiers_of = {}, collections.defaultdict(set), {}, collections.defaultdict(set)
    for h, row in rows.items():
        ic = items[h].get('displayProperties', {}).get('icon', '')
        if ic.startswith(PRE):
            gear.setdefault(row[0], ic[len(PRE):])
            by_slot.setdefault(f'{row[0]}|{SLOTS[row[1]]}', ic[len(PRE):])
            slots_of[row[0]].add(row[1])
            by_tier.setdefault(f'{row[0]}|{SLOTS[row[1]]}|{TIER_NAMES[row[2]]}', ic[len(PRE):])
            tiers_of[f'{row[0]}|{SLOTS[row[1]]}'].add(row[2])
    gear_by_slot = {k: v for k, v in by_slot.items() if len(slots_of[k.split('|')[0]]) > 1}
    gear_by_slot.update({k: v for k, v in by_tier.items() if len(tiers_of[k.rsplit('|', 1)[0]]) > 1})
    KINDS = ('.supers', '.grenades', '.melee', '.aspects', '.fragments', '.class_abilities', '.movement')
    for it in items.values():
        pc = it.get('plug', {}).get('plugCategoryIdentifier', '')
        name = it.get('displayProperties', {}).get('name', '').strip()
        ic = it.get('displayProperties', {}).get('icon', '')
        if pc and (any(k in pc for k in KINDS) or pc.startswith('artifact')) and name and not name.startswith('Empty') and ic.startswith(PRE):
            plugs.setdefault(name, ic[len(PRE):])
    artifacts = {}
    for it in items.values():
        ic = it.get('displayProperties', {}).get('icon', '')
        if it.get('itemTypeDisplayName') == 'Artifact' and ic.startswith(PRE):
            artifacts.setdefault(it['displayProperties']['name'].strip(), ic[len(PRE):])
    # Each artifact's own perk icons, from its sockets' plug sets: perk names repeat across seasons
    # with different art, so a lookup by name alone can show another season's icon.
    plug_sets = json.loads(get('https://www.bungie.net' + paths['DestinyPlugSetDefinition']))
    artifact_perks, perk_text = {}, {}
    sandbox_perks = json.loads(get('https://www.bungie.net' + paths['DestinySandboxPerkDefinition'])) if artifact_text or ability_text else {}
    for it in items.values():
        if it.get('itemTypeDisplayName') != 'Artifact' or not it.get('sockets', {}).get('socketEntries'):
            continue
        perks = {}
        for e in it['sockets']['socketEntries']:
            ps = plug_sets.get(str(e.get('reusablePlugSetHash') or e.get('randomizedPlugSetHash') or 0), {})
            for x in ps.get('reusablePlugItems', []):
                d = items.get(str(x['plugItemHash']), {}).get('displayProperties', {})
                name, ic = d.get('name', '').strip(), d.get('icon', '')
                if name and not name.startswith('Empty') and name != 'Reset Artifact' and ic.startswith(PRE):
                    perks.setdefault(name, ic[len(PRE):])
                    # The words the game shows: the plug's visible sandbox perks, else its own description.
                    plug = items.get(str(x['plugItemHash']), {})
                    text = '\n\n'.join(t for t in (sandbox_perks.get(str(q['perkHash']), {}).get('displayProperties', {}).get('description', '').strip()
                                                    for q in plug.get('perks', []) if q.get('perkVisibility') == 0) if t) or d.get('description', '').strip()
                    text = clean_text(text)
                    if text:
                        perk_text.setdefault(f"{it['displayProperties']['name'].strip()}|{name}", text)
        if perks:
            artifact_perks.setdefault(it['displayProperties']['name'].strip(), perks)
    if artifact_text:
        with open(artifact_text, 'w', encoding='utf-8') as f:
            f.write("// Artifact perk descriptions exactly as the game shows them, from Bungie's manifest (each perk's\n// sandbox perk text). Keyed by \"Artifact|Perk\". Generated by tools/fetch_sources.py.\n\nexport const ARTIFACT_TEXT: Record<string, string> = {\n")
            for k in sorted(perk_text):
                f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(perk_text[k], ensure_ascii=False)},\n')
            f.write('}\n')
        print('wrote', artifact_text, len(perk_text), 'artifact perks')
    json.dump({'gear': gear, 'gearBySlot': gear_by_slot, 'plugs': plugs, 'artifacts': artifacts, 'artifactPerks': artifact_perks}, open(icon_table, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print('wrote', icon_table, len(gear), 'gear', len(plugs), 'plugs')

# Exotic armor Collections entries (collectible hash -> [name, classType]), so a signed-in player's
# device can tell which Exotics are unlocked in their Collections.
if exotic_table:
    ex = {}
    for it in items.values():
        if it.get('itemType') == 2 and it.get('inventory', {}).get('tierType') == 6 and it.get('classType') in CLS and it.get('collectibleHash'):
            name = it.get('displayProperties', {}).get('name', '').strip()
            if name:
                ex[str(it['collectibleHash'])] = [name, it['classType']]
    json.dump({'collectibles': ex}, open(exotic_table, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print('wrote', exotic_table, len(ex), 'Exotic armor collectibles')

# Gear progression: Uncommon and Rare weapons per slot that can be pulled from Collections, and
# each one's weapon type ("Auto Rifle") for the upgrade steps.
if tier_table:
    WB = {1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power'}
    weapons, types = {}, {}
    for it in items.values():
        inv = it.get('inventory', {})
        slot, tier = WB.get(inv.get('bucketTypeHash')), inv.get('tierTypeName')
        name = it.get('displayProperties', {}).get('name', '').strip()
        if slot and tier in ('Uncommon', 'Rare') and it.get('itemType') == 3 and it.get('collectibleHash') and name:
            lst = weapons.setdefault(slot, {}).setdefault(tier, [])
            if name not in lst:
                lst.append(name)
            if it.get('itemTypeDisplayName'):
                types[name] = it['itemTypeDisplayName']
    for tiers in weapons.values():
        for lst in tiers.values():
            lst.sort()
    json.dump({'weapons': weapons, 'types': types}, open(tier_table, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print('wrote', tier_table)

# Ability descriptions exactly as the game shows them: every plug on each subclass's sockets (Supers,
# class abilities, melees, grenades), or for aspects and fragments their sandbox perk text.
# Keyed "Element|kind|Name", as the app's ability ids are.
if item_table and icon_table and ability_text:
    ELEM = {'Gunslinger': 'Solar', 'Dawnblade': 'Solar', 'Sunbreaker': 'Solar', 'Arcstrider': 'Arc', 'Stormcaller': 'Arc', 'Striker': 'Arc',
            'Nightstalker': 'Void', 'Voidwalker': 'Void', 'Sentinel': 'Void', 'Revenant': 'Stasis', 'Shadebinder': 'Stasis', 'Behemoth': 'Stasis',
            'Threadrunner': 'Strand', 'Broodweaver': 'Strand', 'Berserker': 'Strand'}
    KIND = {'supers': 'super', 'class_abilities': 'class', 'melee': 'melee', 'grenades': 'grenade', 'aspects': 'aspect',
            'fragments': 'fragment', 'prism_grenade': 'grenade', 'totems': 'aspect', 'trinkets': 'fragment'}
    text = {}
    for it in items.values():
        sub = it.get('displayProperties', {}).get('name', '').strip()
        if it.get('itemType') != 16 or it.get('classType') not in CLS or not (sub in ELEM or sub.startswith('Prismatic')):
            continue
        el = 'Prismatic' if sub.startswith('Prismatic') else ELEM[sub]
        for e in it.get('sockets', {}).get('socketEntries', []):
            ps = plugsets.get(str(e.get('reusablePlugSetHash') or 0))
            hashes = [x['plugItemHash'] for x in ps['reusablePlugItems']] if ps else ([e['singleInitialItemHash']] if e.get('singleInitialItemHash') else [])
            if not hashes:
                continue
            kind = KIND.get(items.get(str(hashes[-1]), {}).get('plug', {}).get('plugCategoryIdentifier', '').split('.')[-1])
            if not kind:
                continue
            for h in hashes:
                plug = items.get(str(h), {})
                name = plug.get('displayProperties', {}).get('name', '').strip()
                desc = plug.get('displayProperties', {}).get('description', '').strip()
                if not desc:
                    parts = []
                    for q in plug.get('perks', []):
                        sp = sandbox_perks.get(str(q['perkHash']), {})
                        t = sp.get('displayProperties', {}).get('description', '').strip()
                        if t and sp.get('isDisplayable', True) and t not in parts:
                            parts.append(t)
                    desc = '\n\n'.join(parts)
                desc = clean_text(desc)
                if name and not name.lower().startswith('empty') and desc:
                    text.setdefault(f'{el}|{kind}|{name}', desc)
    with open(ability_text, 'w', encoding='utf-8') as f:
        f.write("// Ability descriptions exactly as the game shows them, from Bungie's manifest (each subclass's\n// plugs, or their perk text for aspects and fragments). Keyed by ability id (\"Element|kind|Name\").\n\nexport const ABILITY_TEXT: Record<string, string> = {\n")
        for k in sorted(text):
            f.write(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(text[k], ensure_ascii=False)},\n')
        f.write('}\n')
    print('wrote', ability_text, len(text), 'abilities')
