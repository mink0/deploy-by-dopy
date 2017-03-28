const dopy = global.dopy;

const CHECK_CMD= 'pgrep -P 1 -l | grep node | awk \'{print $1}\' | xargs ps u';

exports.command = 'check';

exports.desc = 'Print file from remote server';

exports.task = (env, argv, taskCb) => {
  env.remote(CHECK_CMD, { mute: true }, (err, res) => {
    if (!res) return taskCb(null);

    let stdout = [];

    res.forEach((rs, i) => {
      if (rs.stdout !== '') stdout.push(`${env.config.remote.servers[i]}:\n${rs.stdout}`);
    });

    if (stdout.length > 0) {
      env.log('WARNING: found hung nodejs processes:', 'bgRed');
      stdout.forEach(i => env.log(i, 'reset'));
    }

    taskCb(null);
  });
};
