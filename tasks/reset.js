const dopy = global.dopy;

exports.command = 'reset [targets]';

exports.desc = 'Git reset local repository';

exports.builder = (yargs) => {
  let targets = dopy.config.env.config.targets;

  if (targets) {
    yargs.demand(1);

    for (let target in targets) {
      yargs.command(target, `path: ${targets[target].remote.path}`);
    }
  }
};

exports.task = (env, argv, taskCb) => {
  env.targets.forEach(target => {
    target.local('git reset --hard', { verbose: true }, taskCb);
  });
};
