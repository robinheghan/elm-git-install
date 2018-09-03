const fs = require('fs');
const git = require('simple-git')();

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

  if (!fs.existsSync('elm-stuff/gitdeps')) {
    fs.mkdirSync('elm-stuff/gitdeps');
  }

  for (const url in gitDeps) {
    const ref = gitDeps[url];
    const subPath = pathify(url);
    const path = `elm-stuff/gitdeps/${subPath}`;

    if (fs.existsSync(path)) {
      updateDependency(path, ref);
    } else {
      cloneDependency(url, path, ref);
    }
  }
}

function pathify(url) {
  const colon = url.indexOf(':') + 1;
  let end = url.indexOf('.git');

  if (end === -1) {
    end = url.length;
  }
  
  return url.slice(colon, end);
}

function cloneDependency(url, path, ref) {
  console.log(`cloning ${url} into ${path} and checking out ${ref}`);

  git.clone(url, path, () => {
    const git = require('simple-git')(path);
    git.checkout(ref);
    console.log('done');
  });
}

function updateDependency(path, ref) {
  console.log(`updating ${path} to ${ref}`);
  const git = require('simple-git')(path);

  git.pull(() => {
    git.checkout(ref);
    console.log('done');
  });
}
