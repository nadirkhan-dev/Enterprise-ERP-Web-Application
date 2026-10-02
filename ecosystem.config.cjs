module.exports = {
  apps: [
    {
      name: 'liberty-connect',
      script: '.output/server/index.mjs',
      env: {
        PORT: 3000,
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '50M',
      retain: 5,
    },
  ],
}
