const chalk = require('chalk');
const inquirer = require('inquirer');
const async = require('async');

const dopy = global.dopy;

exports.command = 'reset-branch [targets]';

exports.desc = 'Reset repository branches to configured branch';

exports.builder = (yargs) => {
  let targets = dopy.config.env.config.targets;

  yargs
    .boolean('f')
    .describe('f', 'force git push')
    .default('b', 'master')
    .describe('b', 'target branch will be reset to this one');

  if (targets) {
    yargs.demand(1);

    // resolve all targets for verbose help
    dopy.config.initTargets('ALL');
    let rconfig;
    for (let target in targets) {
      rconfig = targets[target].remote;
      yargs.command(target, `branch: ${chalk.yellow(rconfig.branch)}`);
    }
  }
};

exports.task = (env, argv, taskCb) => {
  let targetBranch = argv.b || 'master';
  let forcePush = argv.f || false;
  let tasks = [];

  if (!env.targets) env.targets = [env];

  env.targets.forEach(t => tasks.push(cb => targetProcessor(t, cb)));

  async.series(tasks, taskCb);

  function targetProcessor(target, targetCb) {
    let rconfig = target.config.remote;
    let lconfig = target.config.local;

    async.series([
      gitFetch,
      changeCurBranch,
      resetBranch,
      showStatus,
      confirmPush,
      gitPush,
      resetToOrigin
    ], targetCb);

    function gitFetch(cb) {
      target.log('fetch updates');
      target.local('git fetch --prune', cb);
    }

    function changeCurBranch(cb) {
      target.log(`checkout git branch to configured remote one: "${rconfig.branch}"`);
      target.local(`git checkout ${rconfig.branch}`, cb);
    }

    function resetBranch(cb) {
      target.log(`reset git branch to "${targetBranch}"`);
      target.local(`git reset --hard origin/${targetBranch}`, cb);
    }

    function resetToOrigin(cb) {
      target.log(`reset git branch to origin "${lconfig.branch}"`);
      target.local(`git reset --hard origin/${lconfig.branch}`, cb);
    }

    function showStatus(cb) {
      target.local(
        `git log --pretty=oneline --abbrev-commit --decorate --color -n 2`, cb);
    }

    function confirmPush(cb) {
      let msg = `Do you want to push ${chalk.yellow(lconfig.path)}:${chalk.red(lconfig.branch)}?`;
      inquirer.prompt([{
        type: 'confirm',
        message: msg,
        name: 'confirm'
      }]).then(ans => {
        if (ans.confirm) return cb();

        target.log('skipped by user', 'dim');
        return resetToOrigin(targetCb);
      });
    }

    function gitPush(cb) {
      let cmd = 'git push';
      if (forcePush) cmd = cmd + ' -f';

      target.local(
        `${cmd} origin ${lconfig.branch}:${lconfig.branch}`,
          { verbose: true }, (err, res) => {
            if (err) console.error(err);

            cb();
          });
    }
  }
};
