/**
 * A single bingo goal with an estimated difficulty score.
 */
export interface Goal {
  text: string;
  difficulty: number; // 0.0–1.0
}

/**
 * Hardcoded list of Minecraft bingo goals with difficulty estimates.
 * Must contain at least 25 entries; 50+ gives variety across different seeds.
 */
export const GOALS: readonly Goal[] = [
  // Crafting & tools
  { text: 'Craft a fishing rod',                     difficulty: 0.10 },
  { text: 'Craft a compass',                         difficulty: 0.25 },
  { text: 'Craft a clock',                           difficulty: 0.25 },
  { text: 'Craft an anvil',                          difficulty: 0.45 },
  { text: 'Craft a bookshelf',                       difficulty: 0.30 },
  { text: 'Craft a jukebox',                         difficulty: 0.35 },
  { text: 'Craft a lead',                            difficulty: 0.35 },
  { text: 'Craft a name tag',                        difficulty: 0.60 },
  { text: 'Craft waxed weathered cut copper stairs', difficulty: 0.80 },
  { text: 'Craft a copper spear',                    difficulty: 0.45 },
  { text: 'Craft chisled tuff bricks',               difficulty: 0.55 },
  { text: 'Craft a block from any ore',              difficulty: 0.35 },
  { text: 'Craft an eye of ender',                   difficulty: 0.85 },

  // Mining & resources
  { text: 'Mine a diamond ore',                      difficulty: 0.50 },
  { text: 'Mine an emerald ore',                     difficulty: 0.55 },
  { text: 'Mine ancient debris',                     difficulty: 0.90 },
  { text: 'Mine a block of obsidian',                difficulty: 0.30 },
  { text: 'Find a geode',                            difficulty: 0.40 },
  { text: 'Break a monster spawner',                 difficulty: 0.35 },
  { text: 'Collect a stack of iron ingots',          difficulty: 0.35 },
  { text: 'Collect a stack of gold ingots',          difficulty: 0.60 },
  { text: 'Collect a stack of coal',                 difficulty: 0.15 },
  { text: 'Collect a stack of redstone dust',        difficulty: 0.40 },

  // Exploration & structures
  { text: 'Enter the Nether',                        difficulty: 0.30 },
  { text: 'Find a stronghold',                       difficulty: 0.75 },
  { text: 'Blow up a desert temple (and its loot!)', difficulty: 0.35 },
  { text: 'Loot a jungle temple',                    difficulty: 0.50 },
  { text: 'Loot an ocean monuments gold',            difficulty: 0.80 },
  { text: 'Loot a woodland mansion chest',           difficulty: 0.85 },
  { text: 'Loot a bastion remnant chest',            difficulty: 0.75 },
  { text: 'Enter a nether fortress',                 difficulty: 0.50 },
  { text: 'Loot a shipwreck chest',                  difficulty: 0.35 },
  { text: 'Find a buried treasure',                  difficulty: 0.40 },
  { text: 'Find an archeological site',              difficulty: 0.40 },

  // Mobs & combat
  { text: 'Kill a creeper with fire damage',         difficulty: 0.35 },
  { text: 'Kill a skeleton with an arrow',           difficulty: 0.10 },
  { text: 'Kill an enderman with water',             difficulty: 0.55 },
  { text: 'Kill a blaze with a snowball',            difficulty: 0.70 },
  { text: 'Kill a wither skeleton with fall damage', difficulty: 0.75 },
  { text: 'Kill a ghast with melee damage',          difficulty: 0.85 },
  { text: 'Kill a pillager',                         difficulty: 0.30 },
  { text: 'Kill a drowned',                          difficulty: 0.20 },
  { text: 'Kill an elder guardian',                  difficulty: 0.90 },
  { text: 'Kill a hoglin',                           difficulty: 0.65 },
  { text: 'Kill a phantom',                          difficulty: 0.40 },
  { text: 'Make a villager die to a zombie',         difficulty: 0.50 },
  { text: 'Kill a monster at full hp in one hit',    difficulty: 0.45 },
  { text: 'Kill a nether monster with a trident',   difficulty: 0.75 },
  { text: 'Kill a mob with magic damage',            difficulty: 0.30 },

  // Food & farming
  { text: 'Eat a golden apple',                      difficulty: 0.40 },
  { text: 'Eat a suspicious stew',                   difficulty: 0.25 },
  { text: 'Brew a potion of Strength',               difficulty: 0.60 },
  { text: 'Brew a potion of Night Vision',           difficulty: 0.55 },
  { text: 'Brew a splash potion',                    difficulty: 0.55 },
  { text: 'Grow a pumpkin',                          difficulty: 0.20 },
  { text: 'Grow a melon',                            difficulty: 0.20 },
  { text: 'Breed two cows',                          difficulty: 0.15 },
  { text: 'Breed two pigs',                          difficulty: 0.15 },
  { text: 'Tame a wolf',                             difficulty: 0.30 },
  { text: 'Tame a cat',                              difficulty: 0.30 },
  { text: 'Tame a horse',                            difficulty: 0.35 },
  { text: 'Make a purple sheep',                     difficulty: 0.40 },

  // Achievements & feats
  { text: 'Wear a full set of iron armor',           difficulty: 0.30 },
  { text: 'Wear a full set of diamond armor',        difficulty: 0.75 },
  { text: 'Enchant an item using a table',           difficulty: 0.40 },
  { text: 'Trade with a villager',                   difficulty: 0.25 },
  { text: 'Travel 1000 blocks from spawn',           difficulty: 0.20 },
  { text: 'Sleep in a bed in the Nether (attempt)',  difficulty: 0.50 },
  { text: 'Reach the top of the world (Y=320)',      difficulty: 0.15 },
  { text: 'Ride a pig with a carrot on a stick',     difficulty: 0.35 },
  { text: 'Ride a strider in the Nether',            difficulty: 0.65 },
  { text: 'Fill a map completely',                   difficulty: 0.50 },
  { text: 'Place a banner on a shield',              difficulty: 0.55 },
  { text: 'Get to level 30',                         difficulty: 0.60 },

  // Completely random! (16 goals)
  { text: 'Put armor on a tamed wolf',               difficulty: 0.45 },
  { text: 'Look at the sun with a spyglass',         difficulty: 0.35 },
  { text: 'Get struck by lightning',                 difficulty: 0.70 },
  { text: 'Throw an enchanted tool in lava',         difficulty: 0.55 },
  { text: 'Equip a full armor set with trimmings',   difficulty: 0.80 },
  { text: 'Equip an enchanted golden helmet with trim', difficulty: 0.70 },
  { text: 'Lay down in a cauldron of lava',          difficulty: 0.25 },
  { text: 'Have all 3 types of nugget in your inventory', difficulty: 0.35 },
  { text: 'Fish a fishing rod',                      difficulty: 0.30 },
  { text: 'Type a message in chat and be ignored',   difficulty: 0.05 },
  { text: 'Die 5 times in a row without your opponent dying', difficulty: 0.50 },
  { text: 'Shoot a projectile from a dispenser',     difficulty: 0.25 },
  { text: 'Launch an explosive firework',            difficulty: 0.45 },
  { text: 'Throw an ender pearl without having it land', difficulty: 0.55 },
  { text: 'Jump into a pool of lava in the nether',  difficulty: 0.35 },
  { text: 'Make a redstone circuit with at least 3 different components', difficulty: 0.50 },
];
