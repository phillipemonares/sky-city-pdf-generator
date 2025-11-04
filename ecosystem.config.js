module.exports = {
  apps: [
    {
      name: 'skycity-pdf-generator',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/var/www/sky-city-pdf-generator',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/www/sky-city-pdf-generator/logs/pm2-error.log',
      out_file: '/var/www/sky-city-pdf-generator/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      // Prevent rapid restarts if build doesn't exist
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 5000,
      // Wait before restarting
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};

