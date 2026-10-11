module.exports = {
  apps: [
    {
      name: 'photoprint-service',
      script: 'server.js',
      cwd: '/var/www/photoprint-service',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      error_file: '/var/log/photoprint-service/error.log',
      out_file: '/var/log/photoprint-service/out.log',
      merge_logs: true,
    },
  ],
};
