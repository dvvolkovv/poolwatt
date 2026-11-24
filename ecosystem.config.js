module.exports = {
  apps: [
    {
      name: "poolwatt-bot",
      script: "node_modules/.bin/tsx",
      args: "bot/index.ts",
      cwd: "/home/dv/poolwatt",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "300M",
      autorestart: true,
      watch: false,
      time: true,
    },
    {
      // The grid worker: interval close + token-registry reconciliation
      // (ТЗ §16.4, §16.11).
      name: "poolwatt-worker",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      cwd: "/home/dv/poolwatt",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "300M",
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
};
