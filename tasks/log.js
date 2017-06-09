const dopy = global.dopy;

exports.command = 'log [type]';

exports.desc = 'Show logs from remote server';

exports.builder = (yargs) => {
  if (!dopy.config.env.config.remote) return;

  let targets = dopy.config.env.config.remote.log;

  if (!targets || typeof targets !== 'object') return;

  for (let target in targets) {
    yargs.command(target, `log path: ${targets[target]}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let logs = env.config.remote.log;

  if (!logs) return taskCb('no logs configured for ' + env.name);

  let path = (typeof logs === 'object') ? logs[argv.type || 'noodoo'] : logs;

  let cmd = `tail -n 100 -f ${path}`; //  | grep -v "nd-db:time"
  if (path.includes('journalctl')) cmd = `${path}  -o cat -n 100 -f`;

  env.remote(cmd, { verbose:true }, taskCb);
};
