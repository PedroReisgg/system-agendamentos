module.exports = {
  apps: [{
    name: 'agenda-api',
    script: './src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    env: { NODE_ENV: 'production' }
  }]
};
