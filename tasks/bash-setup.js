const async = require('async');
const inquirer = require('inquirer');
const fs = require('fs');

const debug = require('debug')('bash-setup');

exports.command = 'bash-setup';

exports.desc = 'Prepare bash cinfig at remote servers';

const PROMPTS = {
  dev: '\\[\\e[0;32m\\][\\u@\\h]\\[\\e[0;30m\\]$(__git_ps1 "#%s")\\[\\e[0m\\] \\w \\[\\e[0;32m\\]\\$\\[\\e[0m\\]',
  test: '\\[\\e[0;93m\\][\\u@\\h]\\[\\e[0;30m\\]$(__git_ps1 "#%s")\\[\\e[0m\\] \\w \\[\\e[0;93m\\]\\$\\[\\e[0m\\]',
  prod: '\\[\\e[0;31m\\][\\u@\\h]\\[\\e[0;30m\\]$(__git_ps1 "#%s")\\[\\e[0m\\] \\w \\[\\e[0;31m\\]\\$\\[\\e[0m\\]',
  staging: '\\[\\e[0;34m\\][\\u@\\h]\\[\\e[0;30m\\]$(__git_ps1 "#%s")\\[\\e[0m\\] \\w \\[\\e[0;34m\\]\\$\\[\\e[0m\\]',
  demo: '\\[\\e[0;35m\\][\\u@\\h]\\[\\e[0;30m\\]$(__git_ps1 "#%s")\\[\\e[0m\\] \\w \\[\\e[0;35m\\]\\$\\[\\e[0m\\]',
};

function bashrc(vars) {
  let out = `
# .bashrc

# Source global definitions
if [ -f /etc/bashrc ]; then
  . /etc/bashrc
fi

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions
  `;

  if (vars.envConf)
    out += `
# load app environment
set -a; source ${vars.envConf}; set +a
`;

  return out;
}

function bashProfile(vars) {
  let out =`
# Get non-interactive aliases and functions
if [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi

# Prompt
source ~/.git-prompt.sh
PS1=\'${vars.prompt} \'

# Make git completions work on "g"
source /etc/bash_completion.d/git
__git_complete g __git_main

# Vars
export ndir='${vars.ndir}'
export nduser='${vars.nduser}'
export ndlog='${vars.ndlog}'
export ndqlog='${vars.ndqlog}'

# Aliases
alias g='git'
alias s='sudo'
alias hg='history | grep'
alias ndlog="tail -n200 -f $ndlog"
alias ndqlog="tail -n200 -f $ndqlog"
alias ndreload="${vars.cmd.reload} && sleep 1 && ndlog"
alias ndchdir="${'sudo chown -R $nduser:$nduser $ndir && sudo chmod -R g+w $ndir'}"

# User specific functions
#echo "export SSH_AUTH_SOCK=$SSH_AUTH_SOCK" > ~/.ssh/auth_sock
#alias ssh="source ~/.ssh/auth_sock && echo -e \\"\\nnew ssh socket loaded: $SSH_AUTH_SOCK\\"; ssh"
cd $ndir && git status -sb && git log -1
`;

  return out;
}

exports.builder = (yargs) => {
  yargs
    .describe('t', 'set type of the server')
    .alias('t', 'type')
    .choices('t', Object.keys(PROMPTS));
};

exports.task = (env, argv, taskCb) => {
  let servers = env.config.remote.servers;

  if (!servers) return taskCb('no servers configured for ' + env.name);

  if (!Array.isArray(servers)) servers = [servers];

  let dstUser = process.env.USER;
  let filesToCopy = [{
    src: '/tmp/.bash_profile',
    dst: '~/.bash_profile'
  }, {
    src: '/tmp/.bashrc',
    dst: '~/.bashrc'
  }, {
    src: '~/.gitconfig',
    dst: '~/.gitconfig'
  }, {
    src: '~/.vimrc',
    dst: '~/.vimrc'
  }, {
    src: '~/.my.cnf',
    dst: '~/.my.cnf'
  },{
    src: '~/.vim',
    dst: '~/',
    backupSrc: '~/.vim',
    backupDst: '~/.vim.old'
  }, {
    src: '~/.git-prompt.sh',
    dst: '~/.git-prompt.sh'
  }];

  let bRc;
  let bProfile;

  async.series([
    render,
    confirm,
    upload,
  ], taskCb);

  function render(cb) {
    let vars = {};

    vars.prompt = argv.t ? PROMPTS[argv.t] : detect();

    function detect() {
      let out;

      for(let key in PROMPTS) {
        if (servers[0].includes(key)) {
          out = PROMPTS[key];
          break;
        }
      }

      if (!out) return cb('unknown server type: try set it directly with `-t`');

      return out;
    }

    if (env.config.targets && env.config.targets.noodoo)
      vars.ndir = env.config.targets.noodoo.remote.path;
    else
      vars.ndir = env.config.remote.path;

    vars.nduser = env.config.remote.user || servers[0].split('@')[0];

    if (env.config.remote.log) {
      if (typeof env.config.remote.log === 'object') {
        vars.ndlog = env.config.remote.log.noodoo;
        vars.ndqlog = env.config.remote.log.queue;
      } else {
        vars.ndlog = env.config.remote.log;
        vars.ndqlog = vars.ndlog.split('.log')[0] + '-queue.log';
      }
    }

    vars.cmd = env.config.remote.cmd;

    debug(vars);

    bRc = bashrc(vars);
    bProfile = bashProfile(vars);

    env.log('Generated files:');

    fs.writeFileSync('/tmp/.bashrc', bRc);
    fs.writeFileSync('/tmp/.bash_profile', bProfile);

    cb();
  }

  function confirm(cb) {
    console.log('files to copy: ', filesToCopy);
    inquirer.prompt([{
      type: 'confirm',
      message: 'Upload this files to ' + servers + ' for ' + dstUser + '?',
      name: 'confirm'
    }]).then(ans => {
      if (!ans.confirm) {
        env.log('stopped by user', 'reset');
        return taskCb();
      }

      cb();
    });
  }

  function upload(cb) {
    // FIXME: hack. should init new SSH
    env.ssh.servers.forEach((srv, i) => {
      if (!srv.name.includes('@'))
        servers[i] = env.ssh.servers[i].name = `${dstUser}@${srv.name}`;
      else
        servers[i] = env.ssh.servers[i].name = `${dstUser}@${srv.name.split('@')[1]}`;
    });

    let tasks = [];

    tasks.push(cb => env.remote('mkdir -p ~/.vim/colors', { verbose: true }, cb));

    servers.forEach(srv => {
      let dst = srv.split('@')[1];

      filesToCopy.forEach(f => {
        let bsrc = f.backupSrc || f.dst;
        let bdst = f.backupDst || (f.dst.slice(-1) === '/' ?
          (f.dst.slice(0, -1) + '.old') : (f.dst + '.old'));

        tasks.push(cb =>
          env.remote(`cp -r ${bsrc} ${bdst} || true`, { verbose: true }, cb));
        tasks.push(cb =>
          env.local(`scp -r ${f.src} ${dstUser}@${dst}:${f.dst}`, { verbose: true }, cb));
      });
    });

    async.series(tasks, cb);
  }
};
