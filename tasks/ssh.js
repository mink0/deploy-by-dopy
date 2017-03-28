const spawn = require('child_process').spawn;

const cmd = 'ssh';
const dopy = global.dopy;

exports.command = 'ssh [server]';

exports.desc = 'Ssh to remote server';

exports.builder = (yargs) => {
  if (!dopy.config.env.config.remote) return;

  let targets = dopy.config.env.config.remote.servers;

  if (!targets || typeof targets !== 'object') return;

  for (let target in targets) {
    yargs.command(targets[target]);
  }
};

exports.task = (env, argv, taskCb) => {
  let servers = env.config.remote.servers;

  if (!servers) return taskCb('no servers configured for ' + env.name);

  if (!Array.isArray(servers)) servers = [servers];

  let path = env.config.remote.path || '.';
  if (env.config.targets && env.config.targets.noodoo)
    path = env.config.targets.noodoo.remote.path;

  let srv = argv.server || servers[0];

  if (env.config.remote.user && srv.indexOf('@') === -1)
    srv = `${env.config.remote.user}@${srv}`;

  let params = ['-A', '-t', srv, 'cd ' + path + '; bash'];

  spawn(cmd, params, { stdio: 'inherit' }, taskCb);
};
