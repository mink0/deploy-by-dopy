const dopy = global.dopy;
const opn = require('opn');
const async = require('async');
const chalk = require('chalk');
const inquirer = require('inquirer');
const get = require('lodash.get');

exports.command = 'restart [targets]';

exports.desc = 'Run restart cmd at remote servers';

//FIXME: рестарт должен запускаться либо один раз (один общий)
//либо для каждого таргета (если их много)

// NB! This task is a part of the update task.
// It was moved away to run restarts separately.
exports.builder = (yargs) => {
  yargs
    .boolean('f')
    .describe('f', 'force to use restart instead of reload');

  let targets = dopy.config.env.config.targets;

  if (!targets) return;

  let cmd;
  for (let target in targets) {
    if (targets[target].remote && targets[target].remote.cmd &&
      targets[target].remote.cmd['reload' || 'restart'])
        cmd = targets[target].remote.cmd['reload' || 'restart'];

    yargs.command(target, `cmd: ${cmd}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let tasks = [];

  if (!env.targets) env.targets = [env];

  env.targets.forEach(t => tasks.push(cb => targetProcessor(t, cb)));

  async.series(tasks, taskCb);

  function targetProcessor(target, targetCb) {
    async.series([
      restart,
      postCmd,
      status,
      hangCheck,
      cpuCheck,
      // findOldScreens
    ], targetCb);

    function restart(cb) {
      target.log('restarting the servers:');

      let urls = [];
      if (target.config.local.url) urls.push(target.config.local.url);

      let prompt = (srv, exec) => {
        return () => inquirer.prompt([{
            name: 'confirm',
            type: 'confirm',
            message: `Restart the ${chalk.yellow(srv)} ?`,
          }]).then(ans => {
            if (ans.confirm)
              return exec().then(() => {
                urls.forEach(url => {
                  opn(url);
                });
              });
          });
      };

      let cmd = target.config.remote.cmd.reload ||
        target.config.remote.cmd.restart;

      if (argv.f) cmd = target.config.remote.cmd.restart || cmd;

      target.ssh.execSeries(cmd, prompt, cb);
    }

    function postCmd(cb) {
      if (!target.config.remote.cmd.post) return cb(null);

      target.remote(target.config.remote.cmd.post, cb);
    }

    function status(cb) {
      if (!target.config.remote.cmd.status) return cb(null);

      target.log('server status:');

      let count = 0;
      recursive(cb);

      function recursive(cb) {
        target.remote(target.config.remote.cmd.status, (err, res) => {
          if (err) {
            if (++count > 5) return cb(err);
            else return setTimeout(() => recursive(cb), 1000);
          }

          return cb(null);
        });
      }
    }

    function hangCheck(cb) {
      let cmd = 'pgrep -P 1 -l | grep node | awk \'{print $1}\' | xargs ps u';

      target.remote(cmd, { mute: true }, (err, res) => {
        if (!res || res.exitCode !== 0) return cb(null);

        let stdout = [];
        res.forEach((rs, i) => {
          if (rs.stdout !== '')
            stdout.push(`${target.config.remote.servers[i]}:\n${rs.stdout}`);
        });

        if (stdout.length > 0) {
          target.log('WARNING: found hang nodejs processes:', 'bgRed');
          stdout.forEach(i => target.log(i, 'reset'));
        }

        cb(null);
      });
    }

    function cpuCheck(cb) {
      let maxcpu = 90;
      let cmd = 'ps -eo pcpu,pid,user,args --no-headers| sort -t. -nk1,2 -k4,4 -r |head -n 5';

      target.remote(cmd, { mute: true }, (err, res) => {
        let stdout = [];
        res.forEach((rs, i) => {
          rs.stdout.split('\n').forEach(line => {
            let cpu = parseInt(line.trim().split(' ')[0], 10);
            if (cpu >= maxcpu)
              stdout.push(`${target.config.remote.servers[i]}:\n${line}`);
          });
        });

        if (stdout.length > 0) {
          target.log('WARNING: found high cpu consuming processes:', 'bgRed');
          stdout.forEach(i => target.log(i, 'reset'));
        }

        cb(null);
      });
    }

    function findOldScreens(cb) {
      let cmd = 'ps -eo pid,etime,cmd | grep SCREEN | grep -v grep';
      let maxdays = 1;

      target.remote(cmd, { mute: true }, (err, res) => {
        let stdout = [];
        res.forEach((rs, i) => {
          rs.stdout.split('\n').forEach(line => {
            let arr = line.trim().split(/\s+/);
            let pid = arr[0];
            let etime = arr[1];

            if (etime.split('-')[0] > maxdays)
              stdout.push(`${target.config.remote.servers[i]}:\n${line}`);

          });
        });

        if (stdout.length > 0) {
          target.log('WARNING: found outdated screen session:', 'bgRed');
          stdout.forEach(i => target.log(i, 'reset'));
        }
    });
  }
  }
};
