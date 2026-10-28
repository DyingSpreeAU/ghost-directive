"""Download the Destiny Data Compendium tabs and the Bungie manifest pieces that
parse_compendium.py needs, into a working directory.

    python3 tools/fetch_sources.py /tmp/gd-sources public/bungie-items.json public/bungie-icons.json public/bungie-exotics.json
    python3 tools/parse_compendium.py /tmp/gd-sources src/compendium.ts

The second argument writes the compact weapon/armor lookup table the app uses to
name items from a signed-in player's Vault (hash -> name, slot, tier, class, damage).
The third writes icon paths by name: weapons and armor, and subclass and artifact plugs.

Needs network access to docs.google.com and *.bungie.net. The full item
definition file is about 200 MB.
"""
import collections, json, os, sys, urllib.request

out = sys.argv[1]
item_table = sys.argv[2] if len(sys.argv) > 2 else None
icon_table = sys.argv[3] if len(sys.argv) > 3 else None
exotic_table = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
SHEET = 'https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/gviz/tq?tqx=out:csv&gid='
TABS = {'Arc': 618967225, 'Solar': 1186062409, 'Void': 1907852650, 'Stasis': 1088259962,
        'Strand': 1870531554, 'Prismatic': 1918152785, 'ExoticArmors': 1500097863,
        'ArtifactPerks': 473308249}

def get(url, path=None):
    with urllib.request.urlopen(url) as r:
        data = r.read()
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
    for h, row in rows.items():
        ic = items[h].get('displayProperties', {}).get('icon', '')
        if ic.startswith(PRE):
            gear.setdefault(row[0], ic[len(PRE):])
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
    artifact_perks = {}
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
        if perks:
            artifact_perks.setdefault(it['displayProperties']['name'].strip(), perks)
    json.dump({'gear': gear, 'plugs': plugs, 'artifacts': artifacts, 'artifactPerks': artifact_perks}, open(icon_table, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
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
