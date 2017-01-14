const dopy = global.dopy;

const config = dopy.config;

exports.command = 'log [type]';

exports.desc = 'Show logs for remote server';

exports.builder = (yargs) => {
  let targets = config.env.config.remote.log;

  for (let target in targets) {
    yargs.command(target, `log path: ${targets[target]}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let logs = env.config.remote.log;

  if (!logs) return taskCb('no logs configured for ' + env.name);

  let path;
  if (typeof logs === 'object')
    path = logs[argv.type || 'noodoo'];
  else
    path = logs;

  env.remote(`tail -n100 -f ${path} | grep -v "nd-db:time"`,
    { verbose:true }, taskCb);
};
