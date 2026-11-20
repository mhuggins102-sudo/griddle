// Trophy thresholds per challenge, as [bronze, silver, gold]. Written by tools/calibrate-challenges.js from the
// challenge bot's score distribution (see that tool for the percentiles used); edit by hand after play-testing.
// A line with a comment carries a hand addition on top of the bot's figures, for a twist the bot does not use.
export const TARGETS = {
  'slant-bonus': [175, 210, 235],
  'corner-cutter': [175, 210, 235], // the bot's figures plus 10 / 15 / 20: a twist it does not use, a player can
  'open-field': [175, 205, 235],
  'crossroads': [175, 205, 230],
  'small-change': [180, 205, 230],
  'long-haul': [170, 210, 235],
  'clairvoyant': [173, 200, 237], // the bot's figures plus 8 / 10 / 12: a twist it does not use, a player can
  'pick-of-three': [175, 200, 225],
  'hot-spots': [200, 230, 260],
  'premium-squares': [190, 225, 245],
  'three-jokers': [205, 235, 250],
  'blitz': [90, 110, 130],
  'marathon': [280, 310, 330],
  'drought': [110, 135, 160],
  'dry-well': [160, 190, 210],
  'vowel-flood': [160, 190, 215],
  'heavy-metal': [170, 205, 235], // the bot's figures plus 10 / 15 / 20: a twist it does not use, a player can
  'penny-tiles': [160, 190, 215],
  'what-you-see': [160, 190, 225],
  'quandary': [130, 160, 200],
  'stamp': [165, 198, 225], // the bot's figures plus 5 / 8 / 10: a twist it does not use, a player can
  'no-shorties': [145, 180, 205],
  'full-lines': [120, 155, 205],
  'mirror': [130, 165, 190],
  'slant': [95, 120, 145],
  'horizon': [110, 140, 185],
  'downpour': [115, 150, 185],
  'bullseye': [80, 100, 120],
  'perimeter': [60, 75, 95],
  'chain-reaction': [150, 185, 215],
  'fresh-tiles': [65, 95, 120],
  'twins': [70, 95, 120],
  'lucky-dip': [85, 125, 180],
  'conveyor': [100, 125, 190],
  'rotor': [65, 95, 140],
  'eight-words': [80, 105, 120],
  'boulders': [165, 195, 220],
  'build-around': [195, 225, 255],
};
