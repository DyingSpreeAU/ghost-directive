// Class abilities each subclass can slot, from Bungie's manifest (each subclass's class-ability socket).
// Regenerate with tools/fetch_sources.py if Bungie adds or renames one.

import type { ClassType, Element } from './data'

export const CLASS_ABILITIES: Record<ClassType, Record<Element, string[]>> = {
  "Hunter": {
    "Solar": [
      "Marksman's Dodge",
      "Gambler's Dodge",
      "Acrobat's Dodge"
    ],
    "Arc": [
      "Marksman's Dodge",
      "Gambler's Dodge"
    ],
    "Void": [
      "Marksman's Dodge",
      "Gambler's Dodge"
    ],
    "Stasis": [
      "Marksman's Dodge",
      "Gambler's Dodge"
    ],
    "Strand": [
      "Marksman's Dodge",
      "Gambler's Dodge"
    ],
    "Prismatic": [
      "Marksman's Dodge",
      "Gambler's Dodge",
      "Acrobat's Dodge"
    ]
  },
  "Titan": {
    "Solar": [
      "Towering Barricade",
      "Rally Barricade"
    ],
    "Arc": [
      "Towering Barricade",
      "Rally Barricade",
      "Thruster"
    ],
    "Void": [
      "Towering Barricade",
      "Rally Barricade"
    ],
    "Stasis": [
      "Towering Barricade",
      "Rally Barricade"
    ],
    "Strand": [
      "Towering Barricade",
      "Rally Barricade"
    ],
    "Prismatic": [
      "Towering Barricade",
      "Rally Barricade",
      "Thruster"
    ]
  },
  "Warlock": {
    "Solar": [
      "Healing Rift",
      "Empowering Rift",
      "Phoenix Dive"
    ],
    "Arc": [
      "Healing Rift",
      "Empowering Rift"
    ],
    "Void": [
      "Healing Rift",
      "Empowering Rift"
    ],
    "Stasis": [
      "Healing Rift",
      "Empowering Rift"
    ],
    "Strand": [
      "Healing Rift",
      "Empowering Rift"
    ],
    "Prismatic": [
      "Healing Rift",
      "Empowering Rift",
      "Phoenix Dive"
    ]
  }
}

/** In-game descriptions, keyed like ability ids ("Element|class|Name"). */
export const CLASS_ABILITY_DESC: Record<string, string> = {
  "Arc|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Arc|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Arc|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Arc|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Arc|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Arc|class|Thruster": "Quickly evade in a lateral direction.",
  "Arc|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it.",
  "Prismatic|class|Acrobat's Dodge": "Dodge to perform an acrobatic leap. Upon landing, make yourself and nearby allies radiant.",
  "Prismatic|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Prismatic|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Prismatic|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Prismatic|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Prismatic|class|Phoenix Dive": "Dive to the ground and create a burst of Solar Light that cures nearby allies.",
  "Prismatic|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Prismatic|class|Thruster": "Quickly evade in a lateral direction.",
  "Prismatic|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it.",
  "Solar|class|Acrobat's Dodge": "Dodge to perform an acrobatic leap. Upon landing, make yourself and nearby allies radiant.",
  "Solar|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Solar|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Solar|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Solar|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Solar|class|Phoenix Dive": "Dive to the ground and create a burst of Solar Light that cures nearby allies.\n\nWhile Heat Rises is active, you gain restoration while diving and scorch targets upon landing.",
  "Solar|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Solar|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it.",
  "Stasis|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Stasis|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Stasis|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Stasis|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Stasis|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Stasis|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it.",
  "Strand|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Strand|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Strand|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Strand|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Strand|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Strand|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it.",
  "Void|class|Empowering Rift": "Conjure a well of power that increases weapon damage and ability energy regeneration for those inside it.\n\nDefeating combatants while standing in the Rift grants additional ammo generation.",
  "Void|class|Gambler's Dodge": "Dodge to perform a deft tumble, avoiding combatant attacks and generating melee ability energy. Energy gain is scaled by your Melee stat. Dodging near enemies increases the energy gain.",
  "Void|class|Healing Rift": "Conjure a well of power that continuously heals those inside it.",
  "Void|class|Marksman's Dodge": "Dodge to perform an evasive maneuver with a steady hand. Dodging automatically collects nearby ammo boxes and reloads all weapons.",
  "Void|class|Rally Barricade": "Creates a small barrier that you can peek over while aiming down sights; increases weapon reload speed, stability, and range. Draws hostile fire when you stand behind it.",
  "Void|class|Towering Barricade": "Creates a large barrier that can be used to reinforce a position with cover, and draws hostile fire when you stand behind it."
}
