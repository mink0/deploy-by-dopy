const spawn = require('child_process').spawn;

const cmd = 'ssh';
const dopy = global.dopy;

exports.command = 'ssh [target] [server]';

exports.desc = 'Ssh to remote server';

exports.builder = (yargs) => {
  if (!dopy.config.env.config.remote) return;

  let targets = dopy.config.env.config.targets;

  if (targets) {
    // yargs.demand(1);
    for (let target in targets) {
      let descr = `remote path: ${targets[target].remote.path}`;
      yargs.command(target, descr, srvBuilder);
    }
  } else {
    srvBuilder();
  }

  function srvBuilder() {
    let servers = dopy.config.env.config.remote.servers;

    if (!servers || typeof servers !== 'object') return;

    for (let srv in servers) {
      yargs.command(servers[srv]);
    }
  }
};

exports.task = (env, argv, taskCb) => {
  let servers = env.config.remote.servers;

  if (!servers) return taskCb('no servers configured for ' + env.name);

  if (!Array.isArray(servers)) servers = [servers];

  let target = argv.target;
  let server = argv.server;
  if (!server) {
    if (!env.config.targets) {
      server = target;
      target = null;
    }
  }

  let path = env.config.remote.path || '.';
  let user = env.config.remote.user;
  if (target || env.config.targets) {
    if (target) {
      path = env.config.targets[target].remote.path;
      user = env.config.targets[target].remote.user || target;
    } else if (env.config.targets.noodoo) {
      path = env.config.targets.noodoo.remote.path;
      user = 'noodoo';
    }
  }

  let srv = server || servers[0];
  if (user) {
    if (srv.indexOf('@') === -1) {
      srv = `${user}@${srv}`;
    } else {
      srv = `${user}@${srv.slice('@')[1]}`;
    }
  }

  let params = ['-A', '-t', srv, 'cd ' + path + '; bash'];

  spawn(cmd, params, { stdio: 'inherit' }, taskCb);
};
