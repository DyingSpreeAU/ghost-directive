"""Download the Destiny Data Compendium tabs and the Bungie manifest pieces that
parse_compendium.py needs, into a working directory.

    python3 tools/fetch_sources.py /tmp/gd-sources
    python3 tools/parse_compendium.py /tmp/gd-sources src/compendium.ts

Needs network access to docs.google.com and *.bungie.net. The full item
definition file is about 200 MB.
"""
import collections, json, os, sys, urllib.request

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
SHEET = 'https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/gviz/tq?tqx=out:csv&gid='
TABS = {'Arc': 618967225, 'Solar': 1186062409, 'Void': 1907852650, 'Stasis': 1088259962,
        'Strand': 1870531554, 'Prismatic': 1918152785, 'ExoticArmors': 1500097863}

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
