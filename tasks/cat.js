const dopy = global.dopy;

const config = dopy.config;

exports.command = 'cat [file]';

exports.desc = 'Print file from remote server';

exports.builder = (yargs) => {
  if (!config.env.config.remote) return;

  let targets = config.env.config.remote.cat;

  if (!targets || typeof targets !== 'object') return;

  for (let target in targets) {
    yargs.command(target, `path: ${targets[target]}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let files = env.config.remote.cat;

  if (!files) return taskCb('no cat files configured for ' + env.file);

  let path = (typeof files === 'object') ? files[argv.file || 'config'] : files;

  env.remote(`cat ${path}`, { verbose:true }, taskCb);
};
