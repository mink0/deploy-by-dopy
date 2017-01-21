const dopy = global.dopy;

const config = dopy.config;

exports.command = 'log [type]';

exports.desc = 'Show logs from remote server';

exports.builder = (yargs) => {
  let targets = config.env.config.remote.log;

  for (let target in targets) {
    yargs.command(target, `log path: ${targets[target]}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let logs = env.config.remote.log;

  if (!logs) return taskCb('no logs configured for ' + env.name);

  let path = (typeof logs === 'object') ? logs[argv.type || 'noodoo'] : logs;

  env.remote(`tail -n100 -f ${path} | grep -v "nd-db:time"`,
    { verbose:true }, taskCb);
};
