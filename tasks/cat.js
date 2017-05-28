const dopy = global.dopy;
const get = require('lodash.get');

exports.command = 'cat [target] [file]';

exports.desc = 'Print file from remote server';

exports.builder = (yargs) => {
  if (!dopy.config.env.config.remote) return;

  let targets = dopy.config.env.config.targets;

  if (targets) {
    yargs.demand(1);
    for (let target in targets) {
      let descr = `${target} cat path: ${JSON.stringify(targets[target].remote.cat)}`;
      yargs.command(target, descr, () => {
        let cats = targets[target].remote.cat;

        for (let cmd in cats) {
          yargs.command(cmd, cats[cmd]);
        }
      });
    }
  }

  // global targets
  let gtargets = dopy.config.env.config.remote.cat;

  for (let target in gtargets) {
    yargs.command(target, `cat path: ${JSON.stringify(gtargets[target])}`);
  }
};

exports.task = (env, argv, taskCb) => {
  let file = argv.file;
  let target = argv.target;
  let files;

  if (!file) {
    file = target;
    target = null;
    files = env.config.remote.cat;
  }

  if (target)
    if (get(env.config.targets[target], 'remote.cat'))
      files = env.config.targets[target].remote.cat;

  let cmd;
  if (files && files[file])
    cmd = files[file];
  else
    cmd = file;

  env.remote(`cat ${cmd}`, { verbose:true }, taskCb);
};
