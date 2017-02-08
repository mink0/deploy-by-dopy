const spawn = require('child_process').spawn;

const cmd = 'ssh';
const dopy = global.dopy;
const config = dopy.config;

exports.command = 'ssh [server]';

exports.desc = 'Ssh to remote server';

exports.builder = (yargs) => {
  if (!config.env.config.remote) return;

  let targets = config.env.config.remote.servers;

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

  let srv = argv.server || servers[0];

  let params = ['-A', '-t', srv, 'cd ' + path + '; bash'];

  spawn(cmd, params, { stdio: 'inherit' }, taskCb);
};
