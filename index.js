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
  const elmJson = readElmJson('');
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
    afterUpdate(git, repoPath, ref, opts, next);
  });
}

function updateDependency(repoPath, ref, opts, next) {
  console.log(`updating ${repoPath} to ${ref}`);
  const git = gitInPath(repoPath);

  git.branch((err, branchSummary) => {
    if (branchSummary.current === ref) {
      afterCheckout(repoPath, opts, next);
      return;
    }

    git.fetch(['origin'], () => {
      afterUpdate(git, repoPath, ref, opts, next);
    });
  });
}

function afterUpdate(git, repoPath, ref, opts, next) {
  git.tags((_, tagSummary) => {
    git.branch((err, branchSummary) => {
      if (refIsBranch(branchSummary, tagSummary, ref)) {
        console.error('Branches are not supported, use semver tags or sha\'s.');
        return;
      }

      git.checkout(ref, () => {
        afterCheckout(repoPath, opts, next);
      });
    });
  });
}

function refIsBranch(branchSummary, tagSummary, ref) {
  const refs = branchSummary.all.map((b) => b.replace('remotes/origin/', ''));
  const tags = tagSummary.all;
  const branches = {};

  for (const r of refs) {
    if (tags.indexOf(r) < 0) {
      branches[r] = true;
    }
  }

  if (branchSummary.detached) {
    branches[branchSummary.current] = false;
  }

  return branches[ref];
}

function afterCheckout(repoPath, opts, next) {
  const depElmJson = readElmJson(repoPath);
  const depSources = depElmJson['source-directories'];
  const depGitDeps = depElmJson['git-dependencies'] || {};

  next = ((next) => {
    return (opts) => populateSources(repoPath, depSources, opts, next);
  })(next);

  next = buildUpdateChain(depGitDeps, next);

  console.log('done');
  next(opts);
}

function populateSources(repoPath, depSources, opts, next) {
  depSources = depSources
    .filter((src) => {
      return !src.startsWith(storagePath);
    })
    .map((src) => {
      return path.join(repoPath, src);
    });

  const newSources = dedupe(opts['source-directories'], depSources);
  newSources.sort();
  opts['source-directories'] = newSources;

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


function readElmJson(repoPath) {
  let elmFilePath = path.join(repoPath, 'elm.json');
  let gitDepsPath = path.join(repoPath, 'elm-git.json');

  let elmFileJson = {};
  if (fs.existsSync(elmFilePath)) {
    const elmFile = fs.readFileSync(elmFilePath, { encoding: 'utf-8' });
    elmFileJson = JSON.parse(elmFile);
  }

  let gitDepsJson = {};
  if (fs.existsSync(gitDepsPath)) {
    const gitDeps = fs.readFileSync(gitDepsPath, { encoding: 'utf-8' });
    gitDepsJson = JSON.parse(gitDeps);
  }

  return Object.assign(elmFileJson, gitDepsJson);
}

function writeElmJson(elmJson) {
  const oldElmFile = fs.readFileSync('elm.json', { encoding: 'utf-8' });
  const oldElmJson = JSON.parse(oldElmFile);

  const newElmJson = {};
  for (const key in oldElmJson) {
    newElmJson[key] = elmJson[key]
  }

  const newElmFile = JSON.stringify(newElmJson, null, 4);
  fs.writeFileSync('elm.json', newElmFile, { encoding: 'utf-8' });
}
