export const CHARACTERS = [
  {
    id: 'dante', name: 'Dante', number: 141, primary: 0xd9283e, accent: 0x164bd2,
    colors: 'Red, white & blue', description: 'Race as Dante in his signature red, white and blue suit.',
    photo: `${import.meta.env.BASE_URL}dante-skater.png?v=2`, baseSpeed: 12.65,
  },
  {
    id: 'nova', name: 'Nova', number: 72, primary: 0xff4359, accent: 0x201a31,
    colors: 'Crimson & graphite', description: 'Take to the ice in Nova’s crimson suit and graphite helmet.',
    photo: `${import.meta.env.BASE_URL}nova-skater.png`, baseSpeed: 12.55,
  },
  {
    id: 'kai', name: 'Kai', number: 88, primary: 0xffc64b, accent: 0x152941,
    colors: 'Gold & navy', description: 'Join the starting line in Kai’s gold and navy race colours.',
    photo: `${import.meta.env.BASE_URL}kai-skater.png`, baseSpeed: 12.9,
  },
] as const;

export type CharacterId = typeof CHARACTERS[number]['id'];
export const RESERVE_RACER = { id: 'miro', name: 'Miro', number: 36, primary: 0xa582ff, accent: 0x232044, baseSpeed: 12.35 } as const;
export const RACE_ROSTER = [...CHARACTERS, RESERVE_RACER];

export function isCharacterId(value: unknown): value is CharacterId {
  return CHARACTERS.some(character => character.id === value);
}

export function getCharacter(id: CharacterId) {
  return CHARACTERS.find(character => character.id === id)!;
}

export function createOpponents(selected: CharacterId) {
  return RACE_ROSTER.filter(character => character.id !== selected).map((character, index) => ({
    ...character, lane: [0, 2, 1][index], distance: -5 * (index + 1),
  }));
}
