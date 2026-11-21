// Trophy thresholds per challenge, as [bronze, silver, gold]. Written by tools/calibrate-challenges.js from the
// challenge bot's score distribution (see that tool for the percentiles used); edit by hand after play-testing.
// A line with a comment carries a hand addition on top of the bot's figures, for a twist the bot does not use.
export const TARGETS = {
  'slant-bonus': [165, 180, 210],
  'corner-cutter': [160, 185, 215], // the bot's figures plus 10 / 15 / 20: a twist it does not use, a player can
  'open-field': [165, 185, 205],
  'crossroads': [165, 185, 205],
  'small-change': [170, 185, 205],
  'long-haul': [155, 180, 210],
  'clairvoyant': [158, 180, 202], // the bot's figures plus 8 / 10 / 12: a twist it does not use, a player can
  'pick-of-three': [160, 180, 200],
  'hot-spots': [185, 210, 230],
  'premium-squares': [175, 200, 225],
  'three-jokers': [195, 210, 235],
  'blitz': [80, 95, 110],
  'marathon': [265, 285, 310],
  'drought': [105, 115, 135],
  'dry-well': [150, 165, 190],
  'vowel-flood': [150, 170, 190],
  'heavy-metal': [160, 180, 210], // the bot's figures plus 10 / 15 / 20: a twist it does not use, a player can
  'penny-tiles': [150, 170, 190],
  'what-you-see': [150, 170, 190],
  'quandary': [120, 135, 160],
  'stamp': [160, 173, 200], // the bot's figures plus 5 / 8 / 10: a twist it does not use, a player can
  'no-shorties': [130, 150, 180],
  'full-lines': [110, 125, 155],
  'mirror': [115, 135, 165],
  'slant': [90, 100, 120],
  'horizon': [100, 115, 140],
  'downpour': [105, 120, 150],
  'bullseye': [75, 85, 100],
  'perimeter': [55, 65, 75],
  'chain-reaction': [140, 160, 185],
  'fresh-tiles': [55, 70, 95],
  'twins': [60, 75, 95],
  'lucky-dip': [70, 95, 125],
  'conveyor': [90, 105, 125],
  'rotor': [60, 70, 95],
  'eight-words': [70, 85, 105],
  'boulders': [155, 175, 195],
  'build-around': [180, 200, 225],
};
