const async = require('async');
const chalk = require('chalk');
const inquirer = require('inquirer');
const log = require('debug')('merge');

const BRANCHES = ['test', 'staging', 'development', 'demo', 'vision'];
const dopy = global.dopy;

exports.command = 'merge [targets]';

exports.desc = 'Merge master into selected branches';

exports.builder = (yargs) => {
  yargs
    .describe('b', 'select the branch(es)')
    .choices('b', BRANCHES)
    .boolean('f')
    .describe('f', 'merge without confirmation prompts')
    .example('$0 <env> merge')
    .example('$0 <env> merge -b development,test,staging');

  let targets = dopy.config.env.config.targets;

  if (targets) {
    yargs.demand(1);

    for (let target in targets) {
      yargs.command(target, `local path: ${targets[target].local.path}`);
    }
  }
};

exports.task = (env, argv, taskCb) => {
  let branches = argv.b ? argv.b.split(',') : BRANCHES;
  let target = env.targets ? env.targets[0] : env;
  let failed = [];

  async.series([
    branchLoop,
    printResults
  ], taskCb);

  function printResults(cb) {
    if (failed.length === 0) return cb(null);

    console.log(chalk.bgRed('failed branches:'), failed.join(','));

    cb(null);
  }

  function branchLoop(branchesCb) {
    let tasks = [];

    branches.forEach((branch) => tasks.push(cb => branchProcessor(branch, cb)));

    async.series(tasks, branchesCb);

    function branchProcessor(branch, branchCb) {
      let checkResults = {
        ok: true,
        dups: []
      };

      async.series([
        gitCheckout,
        gitMergeMaster,
        checkChangelog,
        report,
        confirm,
        gitPush
      ], branchCb);

      function gitCheckout(cb) {
        env.log(`changing branch "${branch}"...`);

        target.local('git checkout ' + branch +
          ' && git fetch --prune && git reset --hard origin/' + branch, cb);
      }

      function gitReset(cb) {
        env.log(`reseting branch "${branch}"...`);

        target.local('git reset --hard origin/' + branch, cb);
      }

      function gitMergeMaster(cb) {
        env.log(`merging master into "${branch}"...`);
        target.local('git pull origin master', (err, res) => {
          if (err) {
            env.log('merge failed!', 'red');
            failed.push(branch);
            return gitReset(branchCb);
          }

          cb(null);
        });
      }

      function checkChangelog(cb) {
        // all changes should be in one single section between ##master
        // and ## x.y.z

        env.log('running CHANGELOG.md checks...');

        async.parallel([
          cb => checkSingleSection(cb),
          cb => checkPlacement(cb),
          cb => checkDuplicates(cb),
        ], cb);

        function checkSingleSection(next) {
          target.local('git diff -U0 origin/master CHANGELOG.md | ' +
            'grep "@@" | wc -l', {
              mute: true
            }, (err, res) => {
              if (err) return next(err);

              log('single section (should be 1)', res.stdout);
              if (res.stdout.trim() !== '1') checkResults.ok = false;

              return next(null);
            });
        }

        function checkPlacement(next) {
          let reMaster = /##\smaster/i;
          let reVer = /##\s(\d+)\.(\d+)\.(\d+)/;
          let reDiff = /^[+-]\s/;

          target.local('git diff -U10 origin/master CHANGELOG.md', {
            mute: true
          }, (err, res) => {
            if (err) return next(err);

            if (res.stdout.trim() === '') {
              checkResults.ok = true;
              return next(null);
            }

            let lines = res.stdout.split('\n');
            let masterFound, afterMasterSection;
            for (let i = 0; i < lines.length; i++) {
              if (reMaster.test(lines[i])) masterFound = true;

              if (masterFound && reVer.test(lines[i])) afterMasterSection = true;

              if (afterMasterSection) {
                if (reDiff.test(lines[i].trim())) {
                  log('after master', lines[i].trim());
                  checkResults.ok = false;
                  break;
                }
              }
            }

            return next(null);
          });
        }

        function checkDuplicates(next) {
          let rePost = /\[Post\]/;

          target.local('git diff origin/master CHANGELOG.md', {
            mute: true
          }, (err, res) => {
            if (err) return next(err);

            let lines = res.stdout.split('\n');
            let sorted = lines.slice().sort();
            for (let i = 0; i < sorted.length - 1; i++) {
              if (sorted[i].length > 10 &&
                !rePost.test(sorted[i]) &&
                sorted[i + 1] === sorted[i]) {
                checkResults.dups.push(sorted[i]);
              }
            }

            if (checkResults.dups.length > 0) checkResults.ok = false;

            return next(null);
          });
        }
      }

      function report(cb) {
        target.local('git diff origin/master CHANGELOG.md', {
          mute: true
        }, (err, res) => {
          if (err) return cb(err);

          env.log('git diff origin/master CHANGELOG.md:');

          let lines = res.stdout.split('\n');
          lines.forEach(line => {
            if (checkResults.dups.indexOf(line) !== -1)
              console.log(chalk.magenta(line));
            else
              console.log(line);
          });

          if (checkResults.dups.length > 0) {
            console.log(chalk.inverse('duplicate entries are found!'));
            checkResults.dups.forEach(str => {
              console.log('duplicate:', str);
            });
          }

          return cb(null);
        });
      }

      function confirm(cb) {
        if (argv.f) {
          if (checkResults.ok) return cb(null);

          failed.push(branch);
          return gitReset(branchCb);
        }

        inquirer.prompt([{
          type: 'confirm',
          message: target.config.local.path + ': push branch "' +
            branch + '" to "origin/' + branch + '"?',
          name: 'confirm',
          default: checkResults.ok
        }]).then(ans => {
          if (!ans.confirm) {
            env.log('task canceled. reseting...', 'dim');
            failed.push(branch);
            return gitReset(branchCb);
          }

          return cb(null);
        });
      }

      function gitPush(cb) {
        env.log(`pushing new version of "${branch}" to origin`);
        target.local('git push origin ' + branch + ':' + branch, cb);
      }
    }
  }
};
