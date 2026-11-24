module.exports = {
  apps: [
    {
      // The Next.js site. `npm start` is `next start`, which serves the
      // pre-built .next/ — rebuild before restarting (see CLAUDE.md).
      name: "poolwatt-web",
      script: "npm",
      args: "start",
      cwd: "/home/dv/poolwatt",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "600M",
      autorestart: true,
      watch: false,
      time: true,
    },
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
    {
      // §15 WebSocket channels. Next.js does not serve upgrades, so the
      // sockets live in their own process and nginx routes /ws here.
      name: "poolwatt-realtime",
      script: "node_modules/.bin/tsx",
      args: "realtime/index.ts",
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
