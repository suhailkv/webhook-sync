🚀 Running as a Background Service (Always Online)

We will use PM2 (Process Manager for Node.js) with a Windows service helper.

1. Install PM2 and Windows Startup Helper

Open PowerShell as Administrator:

npm install -g pm2 pm2-windows-startup
pm2-startup install

2. Start the Worker
cd C:\path\to\essl-worker
pm2 start worker.js --name essl-worker
pm2 save