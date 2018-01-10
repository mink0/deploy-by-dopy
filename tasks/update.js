const chalk = require('chalk');
const inquirer = require('inquirer');
const path = require('path');
const async = require('async');
const restartTask = require('./restart').task;

const dopy = global.dopy;

exports.command = 'update [targets]';

exports.desc = 'Synchronize application with remote repository';

exports.builder = (yargs) => {
  yargs
    .boolean('f')
    .describe('f', 'update code and run `npm install` without confirmation')
    .example('$0 <env> update ALL', 'update all avialable targets')
    .example('$0 <env> update target1,target2', 'update multiple targets');

  let targets = dopy.config.env.config.targets;

  if (targets) {
    yargs.demand(1);

    for (let target in targets) {
      yargs.command(target, `remote path: ${targets[target].remote.path}`);
    }
  }
};

exports.task = (env, argv, taskCb) => {
  let report = [];
  let restartPrompt = false;

  async.series([
    preCmd,
    targetsLoop,
    confirmRestart,
    restart,
    printReport,
  ], taskCb);

  function preCmd(cb) {
    if (!env.config.remote.cmd.pre) return cb(null);

    env.remote(env.config.remote.cmd.pre, { verbose: true }, cb);
  }

  function targetsLoop(targetsCb) {
    let tasks = [];

    if (!env.targets) env.targets = [env];

    env.targets.forEach(t => tasks.push(cb => targetProcessor(t, cb)));

    async.series(tasks, targetsCb);
  }

  function confirmRestart(cb) {
    if (!restartPrompt) return printReport(taskCb);

    inquirer.prompt([{
      type: 'confirm',
      message: 'Restart the servers?',
      name: 'confirm'
    }]).then(ans => {
      if (!ans.confirm) return printReport(taskCb);

      return cb(null);
    });
  }

  function restart(cb) {
    restartTask(env, {}, cb);
  }

  function printReport(cb) {
    if (report.length === 0) return cb(null);

    env.log('dov report:');

    let all = report.join('\n\n');
    console.log(all);

    env.local('echo "' + all + '" | pbcopy', { mute: true }, cb);
  }

  function targetProcessor(target, targetCb) {
    let checkResults = {};
    let release = {
      origin: null,
      current: null,
      exact: null
    };
    let noChanges = false;
    let config = target.config.remote;

    async.series([
      checkBranch,
      // targetPreCmd,
      gitFetch,
      checkOriginRelease,
      checkLocalRelease,
      checkMigrations('migrate'),
      checkMigrations('migrate_flexible'),
      checkPackageJson,
      checkFileChanges('config'),
      checkFileChanges('indexes'),
      showDiff,
      confirmUpdate,
      changeCurBranch,
      gitSrvUpdate,
      npmInstall,
      runMigrateTask('migrate'),
      runMigrateTask('migrate_flexible'),
      makeReport,
      showResults,
    ], targetCb);

    function targetPreCmd(cb) {
      if (!target.config.remote.cmd.pre) return cb(null);

      env.remote(target.config.remote.cmd.pre, { verbose: true }, cb);
    }

    function checkBranch(cb) {
      if (argv.f) return cb(null);

      target.remote('git rev-parse --abbrev-ref HEAD', { mute: true },
        function(err, res) {
          if (err) return cb(err);

          for (let i = 0; i < res.length; i++) {
            if (res[i].stdout.trim() !== config.branch) {
              env.log('Current branch is ' + res[i].stdout.trim() + ', ' +
                'but configured ' + config.branch + '!', 'yellow');
              return cb(new Error('branchCheckFailed'));
            }
          }
          return cb(null);
        });
    }

    function gitFetch(cb) {
      target.log('cleanup garbage and fetch updates:');
      target.remote('git fetch --prune', cb);
    }

    function checkOriginRelease(cb) {
      let tagRe = /v(\d+.\d+.\d+)$/i;
      target.remote(
        `git describe --tags --always $(git rev-parse origin/${config.branch})`, {
          mute: true
        }, (err, res) => {
          if (err) return cb(err);

          release.origin = res[0].stdout.trim();

          if (config.branch !== 'master') return cb(null);

          if (!tagRe.test(release.origin)) {
            checkResults['not-release'] = {
              title: `release not found at origin/${config.branch})`,
              descr: release.origin
            };
          } else {
            release.exact = release.origin.match(tagRe)[1];
          }

          return cb(null);
        });
    }

    function checkLocalRelease(cb) {
      target.remote('git describe --tags --always', {
        mute: true
      }, (err, res) => {
        if (err) return cb(err);

        release.local = res[0].stdout.trim();

        return cb(null);
      });
    }

    function checkMigrations(type) {
      let re;
      if (type === 'migrate')
        re = /(migrations\/.*\.(sql|js))/ig;
      else if (type === 'migrate_flexible')
        re = /(migrations\/flexible\/.*\.xml)/ig;

      return (cb) => {
        target.remote(`git diff --name-only origin/${config.branch}`,
          { mute: true }, (err, res) => {
            if (err) return cb(err);

            if (!re.test(res[0].stdout)) return cb(null);

            let migrations = [];

            let lines = res[0].stdout.split('\n');
            lines.forEach(line => {
              if (re.test(line)) migrations.push(line.match(re)[0]);
            });

            let out = chalk.reset('');
            for (let i = 0; i < migrations.length; i++) {
              out += `${i + 1}. ${migrations[i]}\n`;
            }

            checkResults[type] = {
              title: `new ${type}: ${migrations.length} found`,
              descr: out
            };

            return cb(null);
        });
      };
    }

    function checkPackageJson(cb) {
      target.remote('git diff ..origin/' + config.branch +
        ' package.json | grep \'^+\'' +
        ' | awk \'!/package.json/\' | awk \'!/version/\'', { mute: true },
        function(err, res) {
          if (err) return cb(err);
          if (!res[0].stdout) return cb(null);

          checkResults['packages'] = {
            title: 'new packages found',
            descr: res[0].stdout
          };

          return cb(null);
        });
    }

    function checkFileChanges(type) {
      let re;
      if (type === 'config')
        re = /(config.(js|json)\.sample)/ig;
      else if (type === 'indexes')
        re = /(indexes.js)/ig;

      return (cb) => {
        target.remote('ls', { mute: true }, function(err, res) {
          if (err) return cb(err);

          if (!re.test(res[0].stdout)) return cb(null);

          let file = res[0].stdout.match(re)[0];

          target.remote(
            `git diff ..origin/${config.branch} ${file}`, { mute: true },
              function(err, res) {
                if (err) return cb(err);
                if (!res[0].stdout) return cb(null);

                checkResults[type] = {
                  title: `${type} changes found`,
                  descr: res[0].stdout
                };

                return cb(null);
              });
          });
      };
    }

    function showDiff(cb) {
      target.remote(`git diff --name-status ..origin/${config.branch}`,
        (err, res) => {
          if (err) return cb(err);

          if (!res[0].stdout) noChanges = true;

          return cb(null);
      });
    }

    function confirmUpdate(cb) {
      let tags = '';
      Object.keys(checkResults).forEach(res => {
        target.log(chalk.reset.yellow.inverse(checkResults[res].title));
        console.log(checkResults[res].descr);
        tags += chalk.reset.bgRed(res) + ' ';
      });

      target.log('tags:', 'reset');
      target.log('  current: ' + chalk.reset(release.local));
      target.log('  install: ' + chalk.reset(release.origin));

      if (!noChanges) tags += chalk.reset.bgBlack('code');
      else tags += chalk.inverse('no code changes found');

      // draw tagline:
      target.log(chalk.reset('update: ') + tags);

      if (checkResults.migrations)
        target.log('you should run task \`migrate\`!');
      if (checkResults['fx-migrations'])
        target.log('you should run task \`migrate_flexible\`!');
      if (checkResults.config)
        target.log('you should edit config file before restart!');
      if (checkResults.indexes)
        target.log('you should run: npm run \'reindex -- -i deals -d -s 1200\'');
      if (checkResults['packages'])
        target.log('you should run \`npm install\`!');

      if (argv.f) return done();

      inquirer.prompt([{
        type: 'confirm',
        message: `Do you want to update the ${chalk.yellow(target.name)} ?`,
        name: 'confirm'
      }]).then(ans => {
        if (!ans.confirm) {
          target.log('skipped by user', 'dim');
          return targetCb(null);
        }

        done();
      });

      function done() {
        restartPrompt = true;
        cb(null);
      }
    }

    function changeCurBranch(cb) {
      if (!argv.f) return cb(null);

      target.log(`changing current git branch to ${config.branch}`);
      target.remote('git checkout ' + config.branch, cb);
    }

    function gitSrvUpdate(cb) {
      target.log('updating the servers:');
      target.remote(`git reset --hard origin/${config.branch}`,
        function(err, res) {
          if (err) return cb(err);

          target.log(chalk.green('the ') + chalk.yellow(target.name) +
            chalk.green(' is updated to "origin/' + config.branch + '"'));
          return cb(null);
        });
    }

    function npmInstall(cb) {
      if (argv.f) return target.remote('npm install', cb);

      let cmd = 'npm install';

      if (target.config.remote.yarn) cmd = 'yarn install';

      let msg = 'Run ' + chalk.yellow(cmd) + ' ?';

      if (checkResults['packages'])
        msg = 'New modules were found! ' + msg;

      inquirer.prompt([{
        type: 'confirm',
        message: msg,
        name: 'confirm',
        default: !!checkResults['packages']
      }]).then(ans => {
        if (!ans.confirm) return cb(null);
        target.remote(cmd, cb);
      });
    }

    function runMigrateTask(type) {
      return (cb) => {
        if (!checkResults[type] || config.migrateTask === false)
          return cb(null);

        let ndEnv = 'production';
        if (config.branch === 'development') ndEnv = 'development';

        let ndPath = config.path;
        if (env.config.targets && env.config.targets.noodoo)
          ndPath = env.config.targets.noodoo.remote.path;

        let orgName = path.basename(config.path);
        if (orgName === 'flow') orgName = 'deals';

        let cmd = 'npm run migrate';
        if (type === 'migrate_flexible') {
          cmd = 'cd ' + ndPath + ' && NODE_ENV=' + ndEnv +
          ' node tasks ' + orgName + '/' + type;
        }

        //if (argv.f) return target.ssh.execSeries(cmd, cb);
        if (argv.f) return cb(null);

        inquirer.prompt([{
          type: 'confirm',
          message: 'Run: ' + chalk.yellow(cmd) + ' ?',
          name: 'confirm',
          default: false
        }]).then(ans => {
          if (!ans.confirm) return cb(null);
          target.ssh.execSeries(cmd, cb);
        });
      };
    }

    function makeReport(cb) {
      if (config.branch !== 'master') return cb(null);
      if (checkResults['not-release']) return cb(null);

      target.remote('cat ./CHANGELOG.md', { mute: true }, (err, res) => {
        if (err) return cb(err);

        let data = res[0].stdout.trim();
        let lines = data.split('\n');
        let block = [];
        let count = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('##') === 0) count++;
          if (count === 1) block.push(lines[i]);
          if (count === 2) break;
        }

        block.splice(0, 1);

        let out = [];
        out.push(`<b>Релиз ${release.exact} для ${target.name} ` +
                      'установлен на продуктивную систему</b>');
        out.push('Список изменений:');
        block.forEach(function(line) {
          if (line && line.trim() !== '') out.push(line);
        });

        report.push(out.join('\n'));
        cb(null);
      });
    }

    function showResults(cb) {
      target.log('results:');
      target.remote('echo "git log:" && git log --color --oneline -n5' +
        ' && echo "\nlast changed files:" &&' +
        ' git diff --color --name-status @{1}.. || true', cb);
    }
  }
};

