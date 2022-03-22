#!/usr/bin/env node

const fs = require('fs');
const path = require('upath');
const url = require('url');
const gitInPath = require('simple-git');
const isGitCloneable = require('git-clone-able');
const semver = require('semver');

const gitRoot = gitInPath(); // git client for current working directory
const storagePath = path.join('elm-stuff', 'gitdeps');

const gitHubShorthandRE = /^[\w\d]+(?:-[\w\d]+)*\/[\w\d]+(?:-[\w\d]+)*$/i;

const helpMsg =
`usage:
'elm-git-install' will install the dependencies in your 'elm-git.json' file.

'elm-git-install init' will create an 'elm-git.json' file in the current directory.

'elm-git-install install PACKAGE ?VERSION' to add PACKAGE as a dependency, pointing to the tag or SHA specified by VERISON. If no VERSION is specified, the latest tag is installed.

PACKAGE can either be a URL to a git repo or a string of the form 'author/repo', which is expanded to a GitHub URL.
`;


const args = process.argv.slice(2);
const command = args[0];


switch (command) {
  case undefined:
    ensureDependencies();
    break;
  case 'init':
    if (args.length > 1) {
      console.log(helpMsg);
      break;
    }

    initializeElmGitJson();
    break;
  case 'install':
    if (args.length < 2 || args.length > 3) {
      console.log(helpMsg);
      break;
    }

    installPackage(args[1], args[2]);
    break;
  default:
    console.log(helpMsg);
    break;
}


function initializeElmGitJson() {
  if (fs.existsSync('./elm-git.json')) {
    console.log('there is already an elm-git.json file in this directory');
    return;
  }

  fs.writeFileSync(
    'elm-git.json',
    JSON.stringify(
      {'git-dependencies': {direct: {}, indirect: {}}},
      null,
      4
    )
  );

  console.log('elm-git.json has been created in the current directory');
}

function installPackage(package, version) {
  const url = gitHubShorthandRE.test(package)
    ? 'https://github.com/' + package + '.git'
    : package;

  version = version || 'latest';

  if (!fs.existsSync('./elm-git.json')) {
    initializeElmGitJson();
  }

  const elmJson = readElmJson('');

  const verificationError = verifyApplicationElmJson(elmJson);
  if (verificationError !== '') {
    console.log('Invalid elm.json file');
    console.log(verificationError);
    return;
  }

  const gitDeps = buildDependencyLock(elmJson);
  if (url in gitDeps) {
    console.error(`${url} is already installed. Aborting...`);
    return;
  }

  const subPath = pathify(url);
  const repoPath = path.join(storagePath, subPath);

  gitRoot.clone(url, repoPath, (err) => {
    if (err) {
      console.error(err);
      return;
    }

    const git = gitInPath(repoPath);
    if (version === 'latest') {
      git.tags((_, tagSummary) => {
        ref = tagSummary.latest;
        addEntryToElmGitJson(url, ref);
        ensureDependencies();
      });
    } else {
      resolveRef(git, url, repoPath, version, elmJson, (ref) => {
        addEntryToElmGitJson(url, ref);
        ensureDependencies();
      });
    }
  });
}

function addEntryToElmGitJson(url, ref) {
  const gitDepsPath = './elm-git.json';
  const gitDeps = JSON.parse(fs.readFileSync(gitDepsPath, { encoding: 'utf-8' }));
  gitDeps['git-dependencies'].direct[url] = ref;
  fs.writeFileSync(gitDepsPath, JSON.stringify(gitDeps, null, 4), { encoding: 'utf-8' });
}

function ensureDependencies() {
  elmJson = readElmJson('');

  const verificationError = verifyApplicationElmJson(elmJson);
  if (verificationError !== '') {
    console.log('Invalid elm.json file');
    console.log(verificationError);
    return;
  }

  const gitDeps = buildDependencyLock(elmJson);
  elmJson['locked'] = gitDeps;
  elmJson['handled'] = {};

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

function buildDependencyLock(elmJson) {
  let locked = {};

  if (elmJson.type === 'application') {
    locked = Object.assign(
      {},
      elmJson['git-dependencies'].direct,
      elmJson['git-dependencies'].indirect
    );
  } else {
    locked = Object.assign({}, elmJson['git-dependencies']);
  }

  return locked;
}

function buildUpdateChain(gitDeps, next) {
  for (const url in gitDeps) {
    const ref = gitDeps[url];
    const subPath = pathify(url);
    const repoPath = path.join(storagePath, subPath);

    next = ((next) => {
      return (opts) => {
        if (url in opts['handled']) {
          next(opts);
        } else if (fs.existsSync(repoPath)) {
          updateDependency(url, repoPath, ref, opts, next);
        } else {
          cloneDependency(url, repoPath, ref, opts, next);
        }
      }
    })(next);
  }

  return next;
}

function pathify(giturl) {
  const sslRegex = /^([a-zA-Z0-9_]+)@([a-zA-Z0-9._-]+):(.*)$/;

  // If in ssl format, convert to valid url
  if (sslRegex.test(giturl)) {
    const parts = giturl.match(sslRegex);
    giturl = `ssh://${parts[1]}@${parts[2]}/${parts[3]}`
  }

  const url = new URL(giturl);
  return path.join(url.host, url.pathname);
}

function cloneDependency(url, repoPath, ref, opts, next) {
  const name = pathify(url);

  gitRoot.clone(url, repoPath, (err) => {
    if (err) {
      console.error(err);
      return;
    }

    const git = gitInPath(repoPath);
    resolveRef(git, url, repoPath, ref, opts, (ref) => {
      console.log(`${name} => ${ref}`);
      afterUpdate(git, url, repoPath, ref, opts, next);
    });
  });
}

function updateDependency(url, repoPath, ref, opts, next) {
  const git = gitInPath(repoPath);
  const name = pathify(url);

  resolveRef(git, url, repoPath, ref, opts, (resolvedRef) => {
    git.branch((err, branchSummary) => {
      if (resolvedRef != null && branchSummary.current === resolvedRef) {
        console.log(`${name} => ${resolvedRef}`);
        afterCheckout(url, repoPath, resolvedRef, opts, next);
        return;
      }

      // If range has been coerced to a version, we know we have it already
      if (ref !== resolvedRef && semver.valid(resolvedRef)) {
        console.log(`${name} => ${resolvedRef}`);
        afterUpdate(git, url, repoPath, resolvedRef, opts, next);
        return;
      }

      git.fetch(['origin'], (err) => {
        if (err) {
          console.error(err);
          return;
        }

        if (resolvedRef == null) {
          resolveRef(git, url, repoPath, ref, opts, (newResolvedRef) => {
            console.log(`${name} => ${newResolvedRef}`);
            afterUpdate(git, url, repoPath, newResolvedRef, opts, next);
          });
        } else {
          console.log(`${name} => ${resolvedRef}`);
          afterUpdate(git, url, repoPath, resolvedRef, opts, next);
        }
      });
    });
  });
}

function resolveRef(git, url, repoPath, ref, opts, next) {
  const semverRange = toSemVerRange(ref);
  if (semverRange == null) {
    next(ref);
    return;
  }

  const lockedVersion = opts['locked'][url];
  if (lockedVersion) {
    // TODO: Handle cases where locked version can change to a narrower version
    // TODO: Halt program execution
    if (semver.valid(lockedVersion) && !semver.satisfies(lockedVersion, semverRange)) {
      console.error(`A dependency expects that ${url} satisfies ${ref}, but is locked at ${lockedVersion}`);
    }

    return next(lockedVersion);
  }

  git.tags((_, tagSummary) => {
    const matchingTags = withinSemverRange(semverRange, tagSummary.all);
    ref = largestSemver(matchingTags);
    next(ref);
  });
}

function afterUpdate(git, url, repoPath, ref, opts, next) {
  git.tags((_, tagSummary) => {
    git.branch((err, branchSummary) => {
      if (refIsBranch(branchSummary, tagSummary, ref)) {
        console.error('Branches are not supported, use semver tags or sha\'s.');
        return;
      }

      git.checkout(ref, (err) => {
        if (err) {
          console.error(err);
          return;
        }

        afterCheckout(url, repoPath, ref, opts, next);
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

function afterCheckout(url, repoPath, ref, opts, next) {
  const depElmJson = readElmJson(repoPath);

  const verificationError = verifyPackageElmJson(depElmJson);
  if (verificationError !== '') {
    console.log(repoPath + ': Not valid elm json');
    console.log(verificationError);
    return;
  }

  opts['locked'][url] = ref;
  opts['handled'][url] = true;

  const depSources = ['src']; // Can packages have source directories?
  const depGitDeps = depElmJson['git-dependencies'] || {};

  next = ((next) => {
    return (opts) => populateSources(repoPath, depSources, opts, next);
  })(next);

  next = buildUpdateChain(depGitDeps, next);
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

  if (elmJson.type !== 'application') {
    return;
  }

  const locked = elmJson['locked'];
  const oldGitDeps = elmJson['git-dependencies'];
  const newDirectGitDeps = {};
  const newIndirectGitDeps = {};

  for (const url in locked) {
    if (url in oldGitDeps.direct) {
      newDirectGitDeps[url] = locked[url];
    }
  }

  for (const url in locked) {
    if (!(url in oldGitDeps.direct)) {
      newIndirectGitDeps[url] = locked[url];
    }
  }

  const newGitDepsFile = JSON.stringify({
    'git-dependencies': {
      direct: newDirectGitDeps,
      indirect: newIndirectGitDeps
    }
  }, null, 4);

  fs.writeFileSync('elm-git.json', newGitDepsFile, { encoding: 'utf-8' });
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

    if (semver.valid(val) == null) {
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

    if (!isGitCloneable(key)) {
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
    if (!isGitCloneable(key)) {
      return gitDepErr;
    }
  }

  return '';
}

function isObject(obj) {
  return obj != null && !Array.isArray(obj) && typeof obj === 'object';
}

/* SEMVER */

function isProjectName(str) {
  const regex = /^[\w-]+\/[\w-]+$/;
  return regex.test(str);
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
  lowerBound = semver.valid(lower.trim());
  upperBound = semver.valid(upper.trim());

  if (lowerBound == null || upperBound == null) {
    return null;
  }

  return `>=${lowerBound} <${upperBound}`;
}

function withinSemverRange(range, tags) {
  return tags.filter((tag) => {
    const semverTag = semver.valid(tag);
    if (semverTag == null) {
      return false;
    }

    return semver.satisfies(semverTag, range);
  });
}

function largestSemver(tags) {
  if (tags.length === 0) {
    return null;
  }

  let largest = tags[0];

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (semver.gt(tag, largest)) {
      largest = tag;
    }
  }

  return largest;
}
