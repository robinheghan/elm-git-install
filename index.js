const fs = require('fs');
const path = require('path');
const gitInPath = require('simple-git');

const gitRoot = gitInPath(); // git client for current working directory
const storagePath = path.join('elm-stuff', 'gitdeps');


const args = process.argv.slice(2);

if (args.length === 0) {
  ensureDependencies();
} else {
  console.error('This tool doesn\'t take any arguments');
}


function ensureDependencies() {
  const elmJson = readElmJson('elm.json');
  const gitDeps = elmJson['git-dependencies'];

  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath);
  }

  elmJson['source-directories'] = elmJson['source-directories'].filter(
    (src) => !src.startsWith(storagePath)
  );

  const next = buildUpdateChain(gitDeps, writeElmJson);
  next(elmJson);
}

function buildUpdateChain(gitDeps, next) {
  for (const url in gitDeps) {
    const ref = gitDeps[url];
    const subPath = pathify(url);
    const repoPath = path.join(storagePath, subPath);

    if (fs.existsSync(repoPath)) {
      next = ((next) => {
        return (opts) => updateDependency(repoPath, ref, opts, next);
      })(next);
    } else {
      next = ((next) => {
        return (opts) => cloneDependency(url, repoPath, ref, opts, next);
      })(next);
    }
  }

  return next;
}

function pathify(url) {
  const colon = url.indexOf(':') + 1;
  let end = url.indexOf('.git');

  if (end === -1) {
    end = url.length;
  }
  
  return url.slice(colon, end);
}

function cloneDependency(url, repoPath, ref, opts, next) {
  console.log(`cloning ${url} into ${repoPath} and checking out ${ref}`);

  gitRoot.clone(url, repoPath, () => {
    const git = gitInPath(repoPath);
    git.checkout(ref, () => {
      afterCheckout(repoPath, opts, next);
    });
  });
}

function updateDependency(repoPath, ref, opts, next) {
  console.log(`updating ${repoPath} to ${ref}`);
  const git = gitInPath(repoPath);

  git.pull(() => {
    git.checkout(ref, () => {
      afterCheckout(repoPath, opts, next);
    });
  });
}

function afterCheckout(repoPath, opts, next) {
  const depElmJson = readElmJson(path.join(repoPath, 'elm.json'));

  const depSources = depElmJson['source-directories']
        .filter((src) => {
          return !src.startsWith(storagePath);
        })
        .map((src) => {
          return path.join(repoPath, src);
        });

  const newSources = dedupe(opts['source-directories'], depSources);
  newSources.sort();
  opts['source-directories'] = newSources;

  console.log('done');
  next(opts);
}

function dedupe(arr1, arr2) {
  const obj = {};
  const combined = arr1.concat(arr2);

  for (let i of combined) {
    obj[i] = true;
  }

  const result = [];
  for (let i in obj) {
    result.push(i);
  }

  return result;
}


function readElmJson(path) {
  const elmFile = fs.readFileSync(path, { encoding: 'utf-8' });
  return JSON.parse(elmFile);
}

function writeElmJson(elmJson) {
    const newElmFile = JSON.stringify(elmJson, null, 4);
    fs.writeFileSync('elm.json', newElmFile, { encoding: 'utf-8' });
}
