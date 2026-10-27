#!/usr/bin/env node
// Deal a seed and print the board and bag. Usage: node tools/deal.js [seed]
import { deal, boardToString, bagToString } from '../js/engine.js';

const seed = process.argv[2] !== undefined ? Number(process.argv[2]) >>> 0 : (Math.random() * 4294967296) >>> 0;
const { board, bag } = deal(seed);
console.log(`seed ${seed}`);
console.log(boardToString(board));
console.log(`bag ${bagToString(bag)}`);
