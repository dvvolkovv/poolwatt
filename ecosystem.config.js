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
  ],
};
