const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

// Only application source and public install icons contribute to the identity.
// No Git metadata, local settings, device addresses or runtime data enter it.
function mobileVersion(root) {
  const files = [];
  function visit(relative) {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Mobile source must not contain linked files.');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(`${relative}/${name}`);
    else if (stat.isFile()) files.push(relative);
  }
  for (const name of ['mobile-companion/web/src', 'mobile-companion/web/public', 'mobile-companion/web/index.html', 'mobile-companion/web/vite.config.mjs',
    'src', 'mobile-companion/desktop', 'package.json', 'package-lock.json', 'mobile-companion/scripts/mobile-build.cjs']) visit(name);
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update('\0').update(fs.readFileSync(path.join(root, name))).update('\0');
  return hash.digest('hex').slice(0, 24);
}
module.exports = {mobileVersion};
