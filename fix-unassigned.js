const fs = require('fs');
const path = 'src/i18n/translations.ts';
let content = fs.readFileSync(path, 'utf8');
const regex = /"projectOverview\.unassigned": "[^"]*"/g;
content = content.replace(regex, '"projectOverview.unassigned": "Nepriradené"');
fs.writeFileSync(path, content);
console.log('Done');
