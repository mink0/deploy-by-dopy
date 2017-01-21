const async = require('async');
const chalk = require('chalk');
const inquirer = require('inquirer');
const log = require('debug')('merge');

const BRANCHES = ['test', 'staging', 'development', 'demo'];
const dopy = global.dopy;

exports.command = 'merge [targets]';

exports.desc = 'Merge master into selected branches';

exports.builder = (yargs) => {

  yargs
    .example('$0 merge -b test')
    .describe('b', 'Merge master into selected branch')
    .choices('b', BRANCHES);

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
  let checkResults = {};
  let target = env.targets ? env.targets[0] : env;

  branchLoop(taskCb);

  function branchLoop(cb) {
    let tasks = [];

    branches.forEach(function(branch) {
      tasks = tasks.concat([
        cb => gitReset(branch, cb),
        cb => gitMergeMaster(branch, cb),
        cb => checkChangelog(branch, cb),
        cb => report(branch, cb),
        cb => confirm(branch, cb),
        cb => gitPush(branch, cb)
      ]);
    });

    async.series(tasks, cb);

    function gitReset(branch, cb) {
      env.log(`reseting branch "${branch}"...`);

      checkResults.ok = true;
      checkResults.dups = [];
      checkResults.push = false;

      target.local('git checkout ' + branch +
        ' && git fetch && git reset --hard origin/' + branch, cb);
    }

    function gitMergeMaster(branch, cb) {
      env.log(`merging master into "${branch}"...`);
      target.local('git pull origin master', cb);
    }

    function checkChangelog(branch, cb) {
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

    function report(branch, cb) {
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
          env.log(chalk.bgYellow('duplicate entries are found!'));
          checkResults.dups.forEach(str => {
            env.log('duplicate:', str);
          });
        }

        cb(null);
      });
    }

    function confirm(branch, cb) {
      inquirer.prompt([{
        type: 'confirm',
        message: target.config.local.path + ': push branch "' +
          branch + '" to "origin/' + branch + '"?',
        name: 'confirm',
        default: checkResults.ok
      }]).then(ans => {
        if (!ans.confirm) {
          env.log('task canceled. reseting...', 'dim');
          return gitReset(branch, cb);
        }

        checkResults.push = true;
        return cb(null);
      });
    }

    function gitPush(branch, cb) {
      if (!checkResults.push) return cb(null);

      env.log(`pushing new version of "${branch}" to origin`);
      target.local('git push origin ' + branch + ':' + branch, cb);
    }
  }
};
