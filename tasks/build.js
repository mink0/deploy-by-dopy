const inquirer = require('inquirer');
const path = require('path');
const async = require('async');
const os = require('os');
const fs = require('fs');
const moment = require('moment');

const dopy = global.dopy;

exports.command = 'build [targets]';

exports.desc = 'Build new release locally and push it to origin repository';

exports.builder = (yargs) => {
  yargs
    .alias('v', 'version')
    .describe('version', 'specify build version in semver format: X.Y.Z')
    .nargs('v', 1)
    .alias('p', 'patch')
    .describe('patch', 'build patch version: X.Y.Z+1')
    .alias('n', 'minor')
    .describe('minor', 'build minor version: X.Y+1.0')
    .conflicts('minor', 'patch')
    .example('build -v 1.6.2')
    .group(['version', 'patch', 'minor'], 'Version:')
    .alias('h', 'help')
    .completion('completion', () =>
      Object.keys(dopy.config.env.config.targets || {}))
    .check(argv => {
      if (!argv.minor && !argv.patch && !argv.version)
        throw ('release version not provided!');

      return true;
    });
};

exports.task = (env, argv, taskCb) => {
  class SemVer {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    toString() {
      return `${this.x}.${this.y}.${this.z}`;
    }

    patch() {
      this.z++;
    }

    minor() {
      this.y++;
      this.z = 0;
    }
  }

  let version;
  let config = env.config.local;
  if (env.targets) config = env.targets[0].config.local;
  let branch = 'master'; //config.branch;

  let reVer = /(\d+)\.(\d+)\.(\d+)/;

  async.series([
    initGit,
    gitReset,
    gitUpdate,
    parseVersion,
    updatePackageJson,
    updateChangelog,
    commit,
    addTag,
    showChangelog,
    showPackage,
    showLog,
    confirm,
    gitPush,
    gitPushTags,
  ], taskCb);

  function initGit(cb) {
    if (config.path) {
      env.shell.options.cwd = config.path;
      return cb(null);
    }

    if (!config.repo)
      return cb('repo not configured and local path not set');

    let repoUrl = config.repo;
    let repoName = repoUrl.match(/\w+\.\w+$/)[0];
    let repoPath = config.path || path.join(
      os.tmpdir(), repoName + '-' + Date.now()
    );

    let promise = env.local('mkdir ' + repoPath)
      .then(() => env.local(`git clone ${repoUrl} ${repoPath}`,
        { cwd: repoPath, verbose: true }));

    // override cwd for all local commands
    env.shell.options.cwd = repoPath;

    promise.then(res => { cb(null, res); }, err => { cb(err); });
  }

  function gitReset(cb) {
    env.local('git fetch --prune && git reset --hard origin/' +
      branch, cb);
  }

  function gitUpdate(cb) {
    env.local('git checkout ' + branch +
      ' && git fetch --prune && git diff --name-status origin/' +
      branch + ' && git reset --hard origin/' + branch,
      { mute: true }, cb);
  }

  function parseVersion(cb) {
    if (argv.version) return parse(argv.version);

    env.local('git describe --abbrev=0 --tags', { mute: true }, (err, res) => {
      if (err) return cb(err);
      parse(res.stdout);
    });

    function parse(versionString) {
      let s = versionString.trim();

      let x = parseInt(s.match(reVer)[1], 10);
      let y = parseInt(s.match(reVer)[2], 10);
      let z = parseInt(s.match(reVer)[3], 10);

      version = new SemVer(x, y, z);

      if (argv.patch) version.patch();
      else if (argv.minor) version.minor();

      env.log('cooking the release: ' +
        dopy.colors.autoColor(version + '')(version));
      cb(null);
    }
  }

  function updatePackageJson(cb) {
    env.log(`editing 'package.json'...`);

    let file = path.join(env.shell.options.cwd, 'package.json');
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(
      /"version":.*"(\d+.\d+.\d+)"/i,
      '"version": "' + version + '"'
    );
    fs.writeFileSync(file, content, 'utf8');
    cb(null);
  }

  function updateChangelog(cb) {
    env.log(`editing 'CHANGELOG.md'...`);

    let file = path.join(env.shell.options.cwd, 'CHANGELOG.md');
    let data = fs.readFileSync(file).toString();
    let lines = data.split('\n');
    let insertlineNumber = 1;

    let urlRe = /(^.*https:\/\/github.com\/.*\/compare\/)/im;
    let url = data.match(urlRe);
    if (url) {
      url = url[0];
      let prev = 'v' + data.match(/##\s(\d+\.\d+\.\d+)/i)[1];
      url = url + prev + '...' + 'v' + version;
    }

    let ts = moment().format('YYYY-MM-DD HH:mm');
    let insertion = '\n## ' + version + ' ' + ts;
    if (url) insertion += '\n\n' + url;

    lines.splice(insertlineNumber, 0, insertion);

    var text = lines.join('\n');

    fs.writeFileSync(file, text);
    cb(null);
  }

  function commit(cb) {
    let v = 'Version ' + version;
    env.local('git commit -am "' + v + '"', { mute: true }, cb);
  }

  function addTag(cb) {
    let tag = 'v' + version;
    env.log('adding new tag: ' + tag) ;
    env.local('git tag ' + tag, cb);
  }

  function removeTag(cb) {
    let tag = 'v' + version;
    env.log('removing new tag locally ' + tag);
    env.local('git tag -d ' + tag, cb);
  }

  function showChangelog(cb) {
    env.log('CHANGELOG.md:', 'blue');
    env.local('head -n20 CHANGELOG.md', cb);
  }

  function showPackage(cb) {
    env.log('package.json:', 'blue');
    env.local('grep \'version\' package.json', cb);
  }

  function showLog(cb) {
    env.log('git log:', 'blue');
    env.local('git lo -n10', cb);
  }

  function confirm(cb) {
    inquirer.prompt([{
      type: 'confirm',
      message: 'Push "' + branch +
          '" to "origin/' + branch + '"?',
      name: 'confirm'
    }]).then(ans => {
      if (!ans.confirm) {
        env.log('stopped by user', 'dim');
        return removeTag(taskCb);
      }

      cb(null);
    });
  }

  function gitPush(cb) {
    env.log('pushing release to origin:');
    env.local(`git push origin ${branch}:${branch}`, cb);
  }

  function gitPushTags(cb) {
    env.log('pushing tags to origin:');
    env.local('git push origin --tags', cb);
  }
};
