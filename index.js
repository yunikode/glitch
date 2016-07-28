const chalk = require('chalk')
const clear = require('clear')
const CLI = require('clui')
const figlet = require('figlet')
const inquirer = require('inquirer')
const Preferences = require('preferences')
const Spinner = CLI.Spinner
const GitHubApi = require('github')
const _ = require('lodash')
const git = require('simple-git')()
const touch = require('touch')
const fs = require('fs')

const github = new GitHubApi({
  headers: {
    "user-agent": "My-Cool-GitHub-App" // GitHub is happy with a unique user agent
  },
})

const files = require('./lib/files')



clear()
console.log(
  chalk.green(
    figlet.textSync('GlitCh', { horizontalLayout: 'full' })
  )
)

if (files.directoryExists('.git')) {
  console.log(chalk.red('Already a git repository'))
  process.exit()
}

function getGithubCredentials(cb) {
  const questions = [
    {
      name: 'username',
      type: 'input',
      message: 'Enter your Github username or e-mail address:',
      validate: (value) => {
        if (value.length) {
          return true
        } else {
          return 'Please enter your username or e-mail address'
        }
      }
    },
    {
      name: 'password',
      type: 'password',
      message: 'Enter your password:',
      validate: (value) => {
        if (value.length) {
          return true
        } else {
          return 'Please enter your password'
        }
      }
    }
  ]

  inquirer.prompt(questions).then(cb)
}

function getGithubToken(cb) {
  const prefs = new Preferences('glitch')

  if (prefs.github && prefs.github.token) {
    return cb(null, prefs.github.token)
  }

  getGithubCredentials(function(credentials) {
    let status = new Spinner('Authenticating you, please wait...')
    status.start()

    github.authenticate(
      _.extend(
        {
          type: 'basic'
        },
        credentials
      )
    )

    github.authorization.create({
      scopes: ['user', 'public_repo', 'repo', 'repo:status', 'gist'],
      note: 'glitch, the CLi tool for initializing Git repos'
    }, function(err, res) {
      status.stop()
      if (err) return cb(err)
      if (res.token) {
        prefs.github = {
          token: res.token
        }
        return cb(null, res.token)
      }
      return cb()
    })
  })
}

function createRepo(cb) {
  let argv = require('minimist')(process.argv.slice(2))

  const questions = [
    {
      type: 'input',
      name: 'name',
      message: 'Enter a name for the repository:',
      default: argv._[0] || files.getCurrentDirectoryBase(),
      validate: (value) => {
        if (value.length) { return true }
        else { return 'Please enter a name for the repository' }
      }
    },
    {
      type: 'input',
      name: 'description',
      default: argv._[1] || null,
      message: 'Enter a description of the repository'
    },
    {
      type: 'list',
      name: 'visibility',
      message: 'Public or private',
      choices: ['public', 'private'],
      default: 'public'
    }
  ]

  inquirer.prompt(questions).then(function(answers){
    let status = new Spinner('Creating repository...')
    status.start()

    let data = {
      name: answers.name,
      description: answers.description,
      private: (answers.visibility === 'private')
    }

    github.repos.create(
      data,
      (err, res) => {
        status.stop()
        if (err) return cb(err)
        return cb(null, res.html_url + '.git')
      }
    )
  })
}

function createGitIgnore(cb) {
  let filelist = _.without(fs.readdirSync('.'), '.git', '.gitignore')

  if (filelist.length) {
    inquirer.prompt(
      [
        {
          type: 'checkbox',
          name: 'ignore',
          message: 'Select the files and/or folders you wish to ignore:',
          choices: filelist,
          default: ['node_modules', 'bower_components']
        }
      ]
    ).then(function(answers) {
      if (answers.ignore.length) {
        fs.writeFileSync('.gitignore', answers.ignore.join('\n'))
      } else {
        touch ('.gitignore')
      }
      return cb()
    })
  } else {
    touch('.gitignore')
    return cb()
  }
}

function setupRepo(url, cb) {
  let status = new Spinner('Setting up the repository...')
  status.start()

  git
    .init()
    .add('.gitignore')
    .add('./*')
    .commit('Initial commit')
    .addRemote('origin', url)
    .push('origin', 'master')
    .then( () => {
      status.stop()
      return cb()
    })


}

function githubAuth(cb) {
  getGithubToken( (err ,token) => {
    if (err) return cb(err)
    github.authenticate({
      type: 'oauth',
      token: token
    })
    return cb(null, token)
  })
}

githubAuth( (err,authed) => {
  if (err) {
    switch (err.code) {
      case 401:
        console.log(chalk.red('Couldn\'t log you in. Please try again.'))
        break
      case 422:
        console.log(chalk.red('You already have an access token.'))
        break
    }
  }
  if (authed) {
    console.log(chalk.green('Successfully authenticated'))
    createRepo( (err, url ) => {
      console.log(chalk.green( url ))
      if (err) console.log('An error has occured', err)
      if (url) {
        createGitIgnore( () => {
          setupRepo(url, (err) => {
            if (!err) console.log(chalk.green('All done!'))
          })
        })
      }
    })
  }
})
