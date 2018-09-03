const fs = require('fs');

const args = process.argv.slice(2);

if (args.length === 0) {
  ensureDependencies();
} else {
  console.error('This tool doesn\'t support any arguments (yet)');
}

function ensureDependencies() {
  const elmFile = fs.readFileSync('elm.json', { encoding: 'utf-8' });
  const elmJson = JSON.parse(elmFile);
  const gitDeps = elmJson['git-dependencies'];
  console.log(gitDeps);
}
