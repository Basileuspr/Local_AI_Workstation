// Syntax validation only: parsing never imports or executes the project's source.
const fs = require('node:fs');
const parser = require(process.argv[2]);
let failed = false;
for (const file of process.argv.slice(3)) {
  try {
    parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx'] });
    console.log('Syntax passed: ' + file);
  } catch (error) {
    failed = true;
    console.error(file + ': ' + error.message);
  }
}
process.exitCode = failed || process.argv.length < 4 ? 1 : 0;
