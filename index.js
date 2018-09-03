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

  let next = (opts) => {
    const newElmFile = JSON.stringify(opts, null, 4);
    fs.writeFileSync('elm.json', newElmFile, { encoding: 'utf-8' });
  }

  for (const url in gitDeps) {
    const ref = gitDeps[url];
    const subPath = pathify(url);
    const path = `elm-stuff/gitdeps/${subPath}`;

    if (fs.existsSync(path)) {
      next = ((next) => {
        return (opts) => updateDependency(path, ref, opts, next);
      })(next);
    } else {
      next = ((next) => {
        return (opts) => cloneDependency(url, path, ref, opts, next);
      })(next);
    }
  }

  elmJson['source-directories'] = elmJson['source-directories'].filter(
    (src) => !src.startsWith('elm-stuff/gitdeps')
  );

  next(elmJson);
}

function pathify(url) {
  const colon = url.indexOf(':') + 1;
  let end = url.indexOf('.git');

  if (end === -1) {
    end = url.length;
  }
  
  return url.slice(colon, end);
}

function cloneDependency(url, path, ref, opts, next) {
  console.log(`cloning ${url} into ${path} and checking out ${ref}`);

  git.clone(url, path, () => {
    const git = require('simple-git')(path);
    git.checkout(ref, () => {
      afterUpdate(path, opts, next);
    });
  });
}

function updateDependency(path, ref, opts, next) {
  console.log(`updating ${path} to ${ref}`);
  const git = require('simple-git')(path);

  git.pull(() => {
    git.checkout(ref, () => {
      afterUpdate(path, opts, next);
    });
  });
}

function afterUpdate(path, opts, next) {
  const depElmFile = fs.readFileSync(path + '/elm.json', { encoding: 'utf-8' });
  const depElmJson = JSON.parse(depElmFile);

  const sourceObj = {};
  const depSources = depElmJson['source-directories'].map((src) => {
    return `${path}/${src}`;
  });

  const sources = opts['source-directories'].concat(depSources);

  for (let src of sources) {
    sourceObj[src] = true;
  }

  const newSources = [];
  for (let src in sourceObj) {
    newSources.push(src);
  }

  newSources.sort();
  opts['source-directories'] = newSources;

  console.log('done');
  next(opts);
}
