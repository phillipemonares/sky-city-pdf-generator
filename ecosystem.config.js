module.exports = {
  apps: [
    {
      name: 'skycity-pdf-generator',
      script: 'server.js',
      cwd: '/var/www/sky-city-pdf-generator',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NODE_OPTIONS: '--max-http-header-size=16384',
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
    {
      name: 'skycity-pdf-worker',
      script: 'server.js',
      cwd: '/var/www/sky-city-pdf-generator',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        NODE_OPTIONS: '--max-http-header-size=16384',
      },
      error_file: '/var/www/sky-city-pdf-generator/logs/pm2-worker-error.log',
      out_file: '/var/www/sky-city-pdf-generator/logs/pm2-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 5000,
    },
  ],
};

