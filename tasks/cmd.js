exports.command = 'cmd [command]';

exports.desc = 'Run arbitrary command at remote server';

exports.task = (env, argv, taskCb) => {
  env.remote(argv.command, { verbose:true }, taskCb);
};
