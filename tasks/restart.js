const dopy = global.dopy;
const opn = require('opn');
const async = require('async');
const chalk = require('chalk');
const inquirer = require('inquirer');

exports.command = 'restart [targets]';

exports.desc = 'Run restart cmd at remote servers';

exports.builder = (yargs) => {
  yargs
    .boolean('f')
    .describe('f', 'force to use restart instead of reload');

  let targets = dopy.config.env.config.targets;

  if (!targets) return;

  let cmd;
  for (let target in targets) {
    cmd = targets[target].remote.cmd.reload ||
      targets[target].remote.cmd.restart;

    yargs.command(target, `cmd: ${cmd}`);
  }
};

exports.task = (env, argv, taskCb) => {
  if (!env.targets) env.targets = [env];

  // FIXME:
  // нужно сделать общий цикл по всем targets
  // передавать env

  async.series([
    restart,
    postCmd,
    status,
    hangCheck,
    cpuCheck,
  ], taskCb);

  function restart(cb) {
    env.log('restarting the servers:');

    let urls = [];
    env.targets.forEach(t => {
      if (t.config.remote.url) urls.push(t.config.remote.url);
    });

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

    env.targets.forEach(e => {
      let cmd = e.config.remote.cmd.reload || e.config.remote.cmd.restart;

      if (argv.f) cmd = e.config.remote.cmd.restart || cmd;

      e.ssh.execSeries(cmd, prompt, cb);
    });
  }

  function postCmd(cb) {
    if (!env.config.remote.cmd.post) return cb(null);

    env.remote(env.config.remote.cmd.post, cb);
  }

  function status(cb) {
    if (!env.config.remote.cmd.status) return cb(null);

    env.log('server status:');

    let count = 0;
    recursive(cb);

    function recursive(cb) {
      env.remote(env.config.remote.cmd.status, (err, res) => {
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

    env.remote(cmd, { mute: true }, (err, res) => {
      if (!res || res.exitCode !== 0) return cb(null);

      let stdout = [];
      res.forEach((rs, i) => {
        if (rs.stdout !== '')
          stdout.push(`${env.config.remote.servers[i]}:\n${rs.stdout}`);
      });

      if (stdout.length > 0) {
        env.log('WARNING: found hang nodejs processes:', 'bgRed');
        stdout.forEach(i => env.log(i, 'reset'));
      }

      cb(null);
    });
  }

  function cpuCheck(cb) {
    let maxcpu = 1;
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
};
