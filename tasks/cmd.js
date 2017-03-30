const dopy = global.dopy;

exports.command = 'cmd [target] [command]';

exports.desc = 'Run arbitrary command at remote server';

exports.builder = (yargs) => {
  let targets = dopy.config.env.config.targets;

  if (targets) {
    yargs.demand(1);
    for (let target in targets) {
      let descr = `remote path: ${targets[target].remote.path}`;
      yargs.command(target, descr, () => {
        let cmds = targets[target].remote.cmd;

        for (let cmd in cmds) {
          yargs.command(cmd, cmds[cmd]);
        }
      });
    }
  }

  let cmds = dopy.config.env.config.remote.cmd;

  for (let cmd in cmds) {
    yargs.command(cmd, cmds[cmd]);
  }
};

exports.task = (env, argv, taskCb) => {
  let cd;
  let user;
  let cmd = argv.command;
  let target = argv.target;

  let cmds;
  if (!cmd) {
    cmd = target;
    target = null;
    cmds = env.config.remote.cmd;
  }

  if (target) {
    if (env.config.targets && env.config.targets[target]) {
      cmds = env.config.targets[target].remote.cmd;
      cd = env.config.targets[target].remote.path;
      user = env.config.targets[target].remote.user;
    } else {
      cmds = env.config.remote.cmd;
      cd = env.config.remote.path;
      user = env.config.remote.user;
    }
  }

  // find the arguments to send to remote command
  let args = process.argv.slice(process.argv.indexOf(cmd) + 1);

  if (cmds && cmds.hasOwnProperty(cmd)) cmd = cmds[cmd];

  if (args) cmd = `${cmd} ${args.join(' ')}`;

  if (cd) cmd = `cd ${cd} && ${cmd}`;

  env.remote(cmd, { verbose:true, user: user }, taskCb);
};
