const dopy = global.dopy;
const opn = require('opn');
const async = require('async');
const chalk = require('chalk');
const inquirer = require('inquirer');
const get = require('lodash.get');

const STUCK = [{
  ps: 'SCREEN',
  timeout: 2 // in days
}, {
  ps: 'phantom',
  timeout: 2 // in days
}];

exports.command = 'restart [targets]';

exports.desc = 'Run restart cmd at remote servers';

// NB! This task is a part of the update task.
// It was moved away to run restarts separately.
exports.builder = (yargs) => {
  yargs
    .boolean('f')
    .describe('f', 'force to use restart instead of reload');

  let targets = dopy.config.env.config.targets;

  if (!targets) return;

  for (let target in targets) {
    yargs.command(target, JSON.stringify(targets[target].remote.cmd));
  }
};

exports.task = (env, argv, taskCb) => {
  async.series([
    globalRestart,
    targetsRestart,
    hangCheck,
    cpuCheck,
    findStuck
  ], taskCb);

  function globalRestart(cb) {
    async.series([
      restart({
        target: env,
        reload: env.config.remote.cmd.reload,
        restart: env.config.remote.cmd.restart
      }),
      run(env, env.config.remote.cmd.post),
      status(env, env.config.remote.cmd.status),
    ], cb);
  }

  function targetsRestart(cb) {
    if (!env.targets) return cb(null);
    let tasks = [];

    env.targets.forEach(t => tasks.push(next => processor(t, next)));

    async.series(tasks, cb);

    function processor(target, targetCb) {
      let cmd = get(target, 'config.remote.cmd.target');

      if (!cmd) {
        target.log('no cmd.target.restart scripts found');
        return targetCb(null);
      }

      async.series([
        restart({
          target: target,
          reload: cmd.reload,
          restart: cmd.restart
        }),
        run(target, cmd.post),
        status(target, cmd.status),
      ], targetCb);
    }
  }

  function restart(opts) {
    return function(cb) {
      if (!opts.restart && !opts.reload) return cb(null);

      let target = opts.target;

      target.log(`restarting ${target.name}:`);

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

      let cmd = opts.reload || opts.restart;

      if (argv.f) cmd = opts.restart || cmd;

      target.ssh.execSeries(cmd, prompt, cb);
    };
  }

  function run(target, cmd) {
    return function(cb) {
      if (!cmd) return cb(null);

      target.remote(cmd, cb);
    };
  }

  function status(target, cmd) {
    return function(cb) {
      if (!cmd) return cb(null);

      target.log('server status:');

      let count = 0;
      recursive(cb);

      function recursive(cb) {
        target.remote(cmd, (err) => {
          if (err) {
            if (++count > 5)
              return cb(err);
            else
              return setTimeout(() => recursive(cb), 1000);
          }

          return cb(null);
        });
      }
    };
  }

  function hangCheck(cb) {
    let cmd = 'pgrep -P 1 -l | grep node | awk \'{print $1}\' | xargs ps u';

    env.remote(cmd, { mute: true }, (err, res) => {
      if (!res || res.exitCode !== 0) return cb(null);

      let stdout = [];
      res.forEach((rs, i) => {
        if (rs.stdout !== '')
          stdout.push(`${env.config.remote.servers[i]}:\n${rs.stdout}`);
      });

      if (stdout.length > 0) {
        env.log('WARNING: found lost and hang nodejs processes:', 'bgRed');
        stdout.forEach(i => env.log(i, 'reset'));
      }

      cb(null);
    });
  }

  function cpuCheck(cb) {
    let maxcpu = 90;
    let cmd = 'ps -eo pcpu,pid,user,args --no-headers| sort -t. -nk1,2 -k4,4 -r |head -n 5';

    env.remote(cmd, { mute: true }, (err, res) => {
      let stdout = [];
      res.forEach((rs, i) => {
        rs.stdout.split('\n').forEach(line => {
          let cpu = parseInt(line.trim().split(' ')[0], 10);
          if (cpu >= maxcpu)
            stdout.push(`${env.config.remote.servers[i]}:\n${line}`);
        });
      });

      if (stdout.length > 0) {
        env.log('WARNING: found high cpu consuming processes:', 'bgRed');
        stdout.forEach(i => env.log(i, 'reset'));
      }

      cb(null);
    });
  }

  function findStuck(cb) {
    let tasks = [];

    STUCK.forEach(ps => {
      tasks.push(checkPs(ps.ps, ps.timeout));
    });

    async.series(tasks, cb);

    function checkPs(ps, timeout) {
      return function(next) {
        let cmd = `ps -eo pid,etime,cmd | grep ${ps} | grep -v grep`;

        env.remote(cmd, { mute: true }, (err, res) => {
          if (err) return next(null);

          let pids = [];
          let stdout = [];
          res.forEach((rs, i) => {
            rs.stdout.split('\n').forEach(line => {
              let arr = line.trim().split(/\s+/);
              let pid = arr[0];
              let etime = arr[1];

              pids.push(pid);

              if (parseInt(etime.split('-')[0]) >= parseInt(timeout))
                stdout.push(`${env.config.remote.servers[i]}:\n${line}`);
            });
          });

          if (stdout.length > 0) {
            env.log(`WARNING: found stuck process: ${ps}`, 'bgRed');
            stdout.forEach(i => env.log(i, 'reset'));
            env.log('cmd \'' + chalk.reset(`sudo kill ${pids.join(' ')}'`));
          }

          next(null);
        });
      };
    }
  }
};
