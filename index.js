const fs = require('fs');
const path = require('path');
const gitInPath = require('simple-git');
const isGitUrl = require('is-git-url');

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

  const verificationError = verifyElmJson(elmJson);
  if (verificationError !== '') {
    console.log(storagePath + ': Not valid elm.json file');
    console.log(verificationError);
    return;
  }

  const gitDeps = elmJson.type === 'application' ?
        elmJson['git-dependencies'].direct
        : elmJson['git-dependencies'];

  if (!fs.existsSync('elm-stuff')) {
    fs.mkdirSync('elm-stuff');
  }
  
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

  const verificationError = verifyPackageElmJson(depElmJson);
  if (verificationError !== '') {
    console.log(repoPath + ': Not valid elm json');
    console.log(verificationError);
    return;
  }
  
  const depSources = ['src'];
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


/* IO */

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


/* VERIFICATION */

function verifyElmJson(elmJson) {
  const applicationError = verifyApplicationElmJson(elmJson);
  const packageError = verifyPackageElmJson(elmJson);

  if (applicationError === '') {
    return '';
  } else if (packageError === '') {
    return '';
  }

  return applicationError;
}

function verifyApplicationElmJson(elmJson) {
  if (elmJson.type !== "application") {
    return 'Type field of elm.json has to be \'application\'';
  }

  const deps = elmJson['dependencies'];
  if (!isObject(deps)) {
    return "'dependencies' field in elm.json has to be an object";
  }

  const depsErr = checkAppDependencies(deps);
  if (depsErr !== '') {
    return depsErr
  }

  const gitDeps = elmJson['git-dependencies'];
  if (!isObject(gitDeps)) {
    return "'git-dependencies' field in elm-git.json has to be an object";
  }

  const gitDepsErr = checkAppGitDependencies(gitDeps);
  if (gitDepsErr !== '') {
    return gitDepsErr
  }
  
  return '';
}

function checkAppDependencies(deps) {
  const directDeps = deps['direct'];
  const directDepsErr = `'$dependencies.direct' in elm.json should be an object of name => semver.`;
  const directDepsReturn = checkAppDependenciesObject(directDeps, directDepsErr);
  if (directDepsReturn !== '') {
    return directDepsReturn;
  }


  const indirectDeps = deps['indirect'];
  const indirectDepsErr = `'$dependencies.direct' in elm.json should be an object of name => semver.`;
  const indirectDepsReturn = checkAppDependenciesObject(indirectDeps, indirectDepsErr);
  if (indirectDepsReturn !== '') {
    return indirectDepsReturn;
  }

  return '';
}

function checkAppDependenciesObject(deps, depsErr) {
  if (!isObject(deps)) {
    return depsErr;
  }

  for (const key in deps) {
    const val = deps[key];

    if (!isProjectName(key)) {
      return depsErr;
    }

    if (toSemVer(val) == null) {
      return depsErr;
    }
  }

  return '';
}

function checkAppGitDependencies(deps) {
  const directDeps = deps['direct'];
  const directDepsErr = "'$git-dependencies.direct' in elm-git.json should be an object of name => semver.";
  const directDepsReturn = checkAppGitDependenciesObject(directDeps, directDepsErr);
  if (directDepsReturn !== '') {
    return directDepsReturn;
  }


  const indirectDeps = deps['indirect'];
  const indirectDepsErr = "'$git-dependencies.indirect' in elm-git.json should be an object of name => semver.";
  const indirectDepsReturn = checkAppGitDependenciesObject(indirectDeps, indirectDepsErr);
  if (indirectDepsReturn !== '') {
    return indirectDepsReturn;
  }

  return '';
}

function checkAppGitDependenciesObject(deps, depsErr) {
  if (!isObject(deps)) {
    return depsErr;
  }

  for (const key in deps) {
    const val = deps[key];

    if (!isGitUrl(key)) {
      return depsErr;
    }
  }

  return '';
}

function verifyPackageElmJson(elmJson) {
  if (elmJson.type !== 'package') {
    return "'type' field in elm.json has to be 'package'";
  }

  const deps = elmJson['dependencies'];
  if (!isObject(deps)) {
    return "'dependencies' field in elm.json should be an object of name => semver range.";
  }

  for (const key in deps) {
    const val = deps[key];

    if (toSemVerRange(val) == null) {
      return "'dependencies' field in elm.json should be an object of name => semver range.";
    }
  }

  const gitDepErr = "'git-dependencies' field in elm-git.json should be an object of git-url => semver range.";

  const gitDeps = elmJson['git-dependencies'];
  if (!isObject(deps)) {
    return gitDepErr;
  }

  for (const key in gitDeps) {
    if (!isGitUrl(key)) {
      return gitDepErr;
    }
  }

  return '';
}


/* SEMVER */

function isObject(obj) {
  return obj != null && !Array.isArray(obj) && typeof obj === 'object';
}

function isProjectName(str) {
  const regex = /^[\w-]+\/[\w-]+$/;
  return regex.test(str);
}

function toSemVer(str) {
  const semver = /^[0-9]+.[0-9]+.[0-9]+$/;
  if (!semver.test(str)) {
    return null;
  }

  const parts = str.split('.');
  return {
    ctor: 'exact',
    major: parseInt(parts[0]),
    minor: parseInt(parts[1]),
    patch: parseInt(parts[2])
  };
}

function toSemVerRange(str) {
  if (str == null) {
    return null;
  }

  const result = str.split('<= v <');
  if (result.length !== 2) {
    return null;
  }

  const [lower, upper] = result;
  lowerBound = toSemVer(lower.trim());
  upperBound = toSemVer(upper.trim());

  if (lowerBound == null || upperBound == null) {
    return null;
  }

  return {
    ctor: 'range',
    lower: lowerBound,
    upper: upperBound
  };
}
