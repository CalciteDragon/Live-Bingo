const ADJECTIVES = [
  'Swift', 'Bold', 'Silent', 'Blazing', 'Iron', 'Shadow', 'Golden', 'Frozen', 'Mighty', 'Ancient',
];

const NOUNS = [
  'Creeper', 'Enderman', 'Wither', 'Dragon', 'Golem', 'Phantom', 'Blaze', 'Skeleton', 'Zombie', 'Villager',
];

export function generateAlias(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj}${noun}`;
}
