// Exports the S table from text.js to Content/Data/script.json for the Unreal build.
import fs from 'fs';
const src = fs.readFileSync('/home/claude/snowfall/js/text.js', 'utf8').replace(/document\.documentElement\.lang = LANG;/g, '');
const mod = src.replace('const S = {', 'export const S = {');
fs.writeFileSync('/tmp/_text.mjs', mod);
const { S } = await import('/tmp/_text.mjs');
fs.writeFileSync('/home/claude/ue/Snowfall/Content/Data/script.json', JSON.stringify(S, null, 1));
console.log('lines', Object.keys(S).length);
