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

  let next = () => {
    console.log('done');
  }

  for (const url in gitDeps) {
    const ref = gitDeps[url];
    const subPath = pathify(url);
    const path = `elm-stuff/gitdeps/${subPath}`;

    if (fs.existsSync(path)) {
      next = ((next) => {
        return () => updateDependency(path, ref, next);
      })(next);
    } else {
      next = ((next) => {
        return () => cloneDependency(url, path, ref, next);
      })(next);
    }
  }

  next();
}

function pathify(url) {
  const colon = url.indexOf(':') + 1;
  let end = url.indexOf('.git');

  if (end === -1) {
    end = url.length;
  }
  
  return url.slice(colon, end);
}

function cloneDependency(url, path, ref, next) {
  console.log(`cloning ${url} into ${path} and checking out ${ref}`);

  git.clone(url, path, () => {
    const git = require('simple-git')(path);
    git.checkout(ref);
    console.log('done');
    next();
  });
}

function updateDependency(path, ref, next) {
  console.log(`updating ${path} to ${ref}`);
  const git = require('simple-git')(path);

  git.pull(() => {
    git.checkout(ref);
    console.log('done');
    next();
  });
}
